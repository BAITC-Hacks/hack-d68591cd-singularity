import type {
  AnalysisResult,
  DocSide,
  Evidence,
  Finding,
  FunctionMatch,
  MatchStatus,
  TraceStep,
  UnitChange,
  UnitFlow,
  UnitFunction
} from '../types';
import { buildFunctions, clauseUid, holderLabel, sameHolders, type Fn } from './functions';
import {
  extractUnitsLLM,
  findConflicts,
  judgeDuplicates,
  judgeMatches,
  recheckLosses,
  writeConclusion,
  type MatchVerdict
} from './judge';
import { embed, llmStats, MODEL } from './llm';
import { extractText } from './load-doc';
import { parseClauses, toPublicClause, type ParsedClause } from './parse-clauses';
import { clip, cosine, jaccard, norm, quoteInText } from './text';
import { extractStructure, normPosition, unitKey, type UnitDef } from './units';

export interface DocInput {
  side: DocSide;
  name: string;
  buffer: Buffer;
}

export type ProgressFn = (trace: TraceStep[]) => void;

const DISCLAIMER =
  'Выводы сформированы ИИ-агентом, носят рекомендательный характер и требуют проверки ответственным сотрудником. Каждый вывод сопровождается ссылкой на пункт исходного документа.';

/** Порог косинусной близости для пар-кандидатов в дублирование. */
const DUP_THRESHOLD = 0.72;
const MAX_DUP_PAIRS = 60;

export async function analyze(docs: DocInput[], onProgress?: ProgressFn): Promise<AnalysisResult> {
  const t0 = Date.now();
  const callsBefore = llmStats.calls;
  const hitsBefore = llmStats.cacheHits;
  const trace: TraceStep[] = [];

  const step = async <T>(id: string, label: string, fn: () => Promise<T>, detail?: (r: T) => string): Promise<T> => {
    const s: TraceStep = { id, label, status: 'running', startedAt: Date.now() };
    trace.push(s);
    onProgress?.([...trace]);
    try {
      const r = await fn();
      s.status = 'done';
      s.finishedAt = Date.now();
      s.detail = detail?.(r);
      onProgress?.([...trace]);
      return r;
    } catch (e) {
      s.status = 'error';
      s.finishedAt = Date.now();
      s.detail = e instanceof Error ? e.message : String(e);
      onProgress?.([...trace]);
      throw e;
    }
  };

  // 1. Чтение и разбор на пункты
  const parsed = await step(
    'parse',
    'Чтение документов и разбор на пункты',
    async () => {
      const out: Record<DocSide, ParsedClause[]> = { before: [], after: [] };
      for (const d of docs) {
        const text = await extractText(d.buffer, d.name);
        out[d.side].push(...parseClauses(text, d.side, d.name));
      }
      return out;
    },
    (r) => `до: ${r.before.length} пунктов, после: ${r.after.length} пунктов`
  );

  // 2. Состав подразделений — правилом; если правило не сработало — LLM
  const structure = await step(
    'structure',
    'Определение состава подразделений',
    async () => {
      const res: Record<DocSide, UnitDef[]> = { before: [], after: [] };
      for (const side of ['before', 'after'] as const) {
        let units = extractStructure(parsed[side]);
        if (!units.some((u) => u.kind === 'unit')) units = await unitsViaLLM(parsed[side], side);
        res[side] = units;
      }
      return res;
    },
    (r) => `до: ${r.before.map((u) => u.abbr ?? u.name).join(', ')}; после: ${r.after.map((u) => u.abbr ?? u.name).join(', ')}`
  );

  // 3. Функции с носителями
  const fns = await step(
    'functions',
    'Извлечение функций и их носителей',
    async () => ({
      before: buildFunctions(parsed.before, structure.before, 'before'),
      after: buildFunctions(parsed.after, structure.after, 'after')
    }),
    (r) => `до: ${r.before.length}, после: ${r.after.length}`
  );

  // 4. Выравнивание: дословно совпавшие пункты сопоставляются без LLM
  const exact = await step(
    'align',
    'Выравнивание неизменённых пунктов',
    async () => {
      const afterByText = new Map<string, Fn[]>();
      for (const f of fns.after) {
        const k = norm(f.clause.text);
        if (!afterByText.has(k)) afterByText.set(k, []);
        afterByText.get(k)!.push(f);
      }
      const matched = new Map<string, Fn[]>();
      for (const f of fns.before) {
        const hits = afterByText.get(norm(f.clause.text));
        if (hits?.length) matched.set(f.uid, [hits.find((h) => sameHolders(h, f)) ?? hits[0]]);
      }
      return matched;
    },
    (r) => `совпали дословно: ${r.size} из ${fns.before.length}; к сопоставлению ИИ: ${fns.before.length - r.size}`
  );

  // 5. Векторы для отбора кандидатов
  const afterAll = buildAllClauseFns(parsed.after, fns.after);
  const changedBefore = fns.before.filter((f) => !exact.has(f.uid));
  const vectors = await step(
    'embed',
    'Семантические векторы пунктов',
    async () => {
      const texts = [...changedBefore, ...afterAll].map((f) => `${f.context} ${f.clause.text}`.slice(0, 2000));
      const vecs = await embed(texts);
      const map = new Map<string, number[]>();
      [...changedBefore, ...afterAll].forEach((f, i) => map.set(f.uid, vecs[i]));
      return map;
    },
    (r) => `${r.size} векторов`
  );

  const score = (a: Fn, b: Fn) => cosine(vectors.get(a.uid)!, vectors.get(b.uid)!) + 0.3 * jaccard(a.clause.text, b.clause.text);
  const topK = (f: Fn, pool: Fn[], k: number) =>
    pool
      .map((c) => ({ c, s: score(f, c) }))
      .sort((x, y) => y.s - x.s)
      .slice(0, k)
      .map((x) => x.c);

  // 6. LLM: сопоставление изменённых функций
  const afterRef = new Map(afterAll.map((f) => [f.ref, f]));
  const verdicts = await step(
    'match',
    'ИИ-сопоставление изменённых функций',
    () => judgeMatches(changedBefore.map((fn) => ({ fn, candidates: topK(fn, fns.after, 6) }))),
    (r) => {
      const c = countBy(r, (v) => v.verdict);
      return `сохранено: ${c.same ?? 0}, сужено: ${c.narrowed ?? 0}, расширено: ${c.expanded ?? 0}, кандидаты в потерю: ${c.lost ?? 0}`;
    }
  );

  // 7. Самопроверка: каждая «потеря» перепроверяется по всему документу «после»
  const verdictByRef = new Map(verdicts.map((v) => [v.ref, v]));
  const lostFns = changedBefore.filter((f) => verdictByRef.get(f.ref)?.verdict === 'lost');
  await step(
    'recheck',
    'Самопроверка потерь по всему документу',
    async () => {
      const checks = await recheckLosses(lostFns.map((fn) => ({ fn, candidates: topK(fn, afterAll, 12) })));
      let revised = 0;
      for (const c of checks) {
        const v = verdictByRef.get(c.ref);
        if (!v || c.verdict === 'not_covered') continue;
        revised++;
        v.verdict = c.verdict === 'covered' ? 'same' : 'narrowed';
        v.afterRefs = c.afterRefs;
        v.explanation = `Перепроверка: ${c.explanation}`;
        v.confidence = c.confidence;
      }
      return revised;
    },
    (r) => `проверено: ${lostFns.length}, снято ложных потерь: ${r}`
  );

  // 8. Сборка таблицы сопоставления функций
  const beforeFnById = new Map(fns.before.map((f) => [f.uid, f]));
  const matchRows: { fn?: Fn; after: Fn[]; status: MatchStatus; explanation: string; confidence: number; lostPart?: string }[] = [];
  const coveredAfter = new Set<string>();
  for (const f of fns.before) {
    const ex = exact.get(f.uid);
    if (ex) {
      ex.forEach((a) => coveredAfter.add(a.uid));
      const moved = !sameHolders(f, ex[0]);
      matchRows.push({
        fn: f,
        after: ex,
        status: moved ? 'moved' : 'kept',
        explanation: moved
          ? `Текст пункта сохранён дословно, но носитель изменился: ${holderLabel(f)} → ${holderLabel(ex[0])}.`
          : 'Пункт сохранён дословно.',
        confidence: 1
      });
      continue;
    }
    const v = verdictByRef.get(f.ref);
    const after = (v?.afterRefs ?? []).map((r) => afterRef.get(r)).filter((x): x is Fn => !!x);
    after.forEach((a) => coveredAfter.add(a.uid));
    matchRows.push({
      fn: f,
      after,
      status: statusOf(v, f, after),
      explanation: v?.explanation ?? 'Нет решения модели.',
      confidence: v?.confidence ?? 0.3,
      lostPart: v?.lostPart
    });
  }
  for (const a of fns.after) {
    if (coveredAfter.has(a.uid)) continue;
    matchRows.push({ after: [a], status: 'added', explanation: 'Новая формулировка, не сопоставленная ни с одной функцией прежней редакции.', confidence: 0.6 });
  }

  // 9. Дублирование и пересечения в новой структуре
  const dupFindings = await step(
    'duplicates',
    'Поиск дублирования и пересечения функций',
    async () => {
      const unitFns = fns.after.filter((f) => f.holders.some((h) => h.kind === 'unit'));
      const pairs: { id: string; a: Fn; b: Fn; s: number }[] = [];
      for (let i = 0; i < unitFns.length; i++) {
        for (let j = i + 1; j < unitFns.length; j++) {
          const a = unitFns[i];
          const b = unitFns[j];
          const shared = a.holders.some((h) => b.holders.some((g) => g.key === h.key));
          if (shared) continue;
          const va = vectors.get(a.uid);
          const vb = vectors.get(b.uid);
          if (!va || !vb) continue;
          const s = cosine(va, vb);
          if (s >= DUP_THRESHOLD) pairs.push({ id: '', a, b, s });
        }
      }
      pairs.sort((x, y) => y.s - x.s);
      const top = pairs.slice(0, MAX_DUP_PAIRS).map((p, i) => ({ ...p, id: `P${i + 1}` }));
      const judged = await judgeDuplicates(top);
      const byId = new Map(top.map((p) => [p.id, p]));
      return judged
        .filter((v) => v.verdict === 'duplication' || v.verdict === 'overlap')
        .map((v) => ({ v, p: byId.get(v.pair)! }))
        .filter((x) => x.p);
    },
    (r) => `найдено: ${r.length}`
  );

  // 10. Конфликт интересов
  const coi = await step(
    'conflicts',
    'Поиск конфликта интересов (каталог правил IIA/SoD)',
    () =>
      findConflicts(
        fns.after.filter((f) => ['2', '4', '5', '6'].includes(f.clause.section)),
        afterAll.filter((f) => /конфликт|КИ\b|независим|совмещ|объективн/iu.test(f.clause.text))
      ),
    (r) => `кандидатов: ${r.length}`
  );

  // 11. Сборка результата с проверкой каждой цитаты
  const assembled = await step(
    'assemble',
    'Проверка цитат и сборка выводов',
    async () => assemble({ parsed, structure, fns, matchRows, dupFindings, coi, afterRef }),
    (r) => `выводов: ${r.findings.length}, отброшено без подтверждения: ${r.dropped}`
  );

  // 12. Итоговое заключение
  const conclusion = await step(
    'conclusion',
    'Итоговое аналитическое заключение',
    async () => {
      const digest = assembled.findings
        .map((f) => `${f.id} [${f.kind}, ${f.severity}] ${f.title}. ${clip(f.detail, 300)} Источники: ${f.evidence.map((e) => `${e.side === 'before' ? 'до' : 'после'} п. ${e.clauseId}`).join(', ')}`)
        .join('\n');
      const d = await writeConclusion(digest);
      const ids = new Set(assembled.findings.map((f) => f.id));
      return {
        summary: d.summary,
        sections: d.sections.map((s) => ({ ...s, findingIds: s.findingIds.filter((x) => ids.has(x)) })),
        recommendations: d.recommendations.map((r) => ({ ...r, findingIds: r.findingIds.filter((x) => ids.has(x)) })),
        disclaimer: DISCLAIMER
      };
    }
  );

  const units = assembled.units;
  return {
    documents: docs.map((d) => ({
      side: d.side,
      name: d.name,
      clauseCount: parsed[d.side].filter((c) => c.docName === d.name).length
    })),
    clauses: [...parsed.before, ...parsed.after].map(toPublicClause),
    units,
    flows: assembled.flows,
    functions: assembled.functions,
    matches: assembled.matches,
    findings: assembled.findings,
    conclusion,
    trace,
    stats: {
      clausesBefore: parsed.before.length,
      clausesAfter: parsed.after.length,
      unitsCreated: units.filter((u) => u.status === 'created').length,
      unitsRemoved: units.filter((u) => u.status === 'removed').length,
      unitsReorganized: units.filter((u) => u.status === 'reorganized').length,
      unitsRetained: units.filter((u) => u.status === 'retained').length,
      functionsLost: assembled.matches.filter((m) => m.status === 'lost').length,
      findings: assembled.findings.length
    },
    meta: {
      model: MODEL,
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
      fromCache: llmStats.calls - callsBefore > 0 && llmStats.cacheHits - hitsBefore === llmStats.calls - callsBefore
    }
  };
}

// ---------------------------------------------------------------------------------------------

function statusOf(v: MatchVerdict | undefined, f: Fn, after: Fn[]): MatchStatus {
  if (!v || v.verdict === 'lost' || !after.length) return 'lost';
  if (v.verdict === 'narrowed') return 'narrowed';
  if (v.verdict === 'expanded') return 'expanded';
  return after.some((a) => sameHolders(a, f)) ? 'kept' : 'moved';
}

/** Все пункты «после» как кандидаты для самопроверки потерь (не только функциональные разделы). */
function buildAllClauseFns(clauses: ParsedClause[], fns: Fn[]): Fn[] {
  const known = new Map(fns.map((f) => [f.uid, f]));
  const seen = new Set<string>();
  const out: Fn[] = [];
  let n = fns.length;
  for (const c of clauses) {
    const uid = clauseUid(c);
    if (norm(c.text).length < 15 || seen.has(uid)) continue;
    seen.add(uid);
    out.push(known.get(uid) ?? { uid, ref: `A${++n}`, side: c.side, clause: c, holders: [], context: '' });
  }
  return out;
}

async function unitsViaLLM(clauses: ParsedClause[], side: DocSide): Promise<UnitDef[]> {
  const found = await extractUnitsLLM(clauses);
  const byId = new Map(clauses.map((c) => [c.id, c]));
  return found
    .filter((u) => byId.has(u.clauseId))
    .map((u) => {
      const c = byId.get(u.clauseId)!;
      return {
        key: unitKey(u.name, u.abbr || undefined),
        name: u.name,
        abbr: u.abbr || undefined,
        kind: u.kind,
        side,
        clauseId: c.id,
        quote: quoteInText(u.quote, c.text) ? u.quote : c.text,
        positions: u.positions
      };
    });
}

const countBy = <T>(xs: T[], key: (x: T) => string) =>
  xs.reduce<Record<string, number>>((acc, x) => ((acc[key(x)] = (acc[key(x)] ?? 0) + 1), acc), {});

const unitId = (key: string) => `u-${key.toLowerCase().replace(/\s+/g, '-')}`;

/** Дословный фрагмент пункта для цитаты: обрезка по границе слова, без многоточия — чтобы оставаться подстрокой. */
function quoteOf(text: string, max = 320): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(' ')).trim();
}

function ev(c: ParsedClause, quote?: string): Evidence {
  const q = quote && quote.trim() ? quote.trim() : quoteOf(c.text);
  return { side: c.side, docName: c.docName, clauseId: c.id, quote: q, verified: quoteInText(q, c.text) };
}

interface AssembleInput {
  parsed: Record<DocSide, ParsedClause[]>;
  structure: Record<DocSide, UnitDef[]>;
  fns: Record<DocSide, Fn[]>;
  matchRows: { fn?: Fn; after: Fn[]; status: MatchStatus; explanation: string; confidence: number; lostPart?: string }[];
  dupFindings: { v: { verdict: string; explanation: string; recommendation: string; confidence: number }; p: { a: Fn; b: Fn } }[];
  coi: { title: string; detail: string; rule: string; holders: string[]; refs: { ref: string; quote: string }[]; severity: 'high' | 'medium' | 'low'; confidence: number; recommendation: string }[];
  afterRef: Map<string, Fn>;
}

function assemble({ parsed, structure, fns, matchRows, dupFindings, coi, afterRef }: AssembleInput) {
  const clauseOf = (side: DocSide, docName: string, id: string) =>
    parsed[side].find((c) => c.docName === docName && c.id === id);

  // --- функции (публичная форма)
  const functions: UnitFunction[] = [...fns.before, ...fns.after].map((f) => ({
    id: f.uid,
    side: f.side,
    unitIds: f.holders.map((h) => unitId(h.key)),
    text: f.context ? `${f.context.replace(/:$/, '')}: ${f.clause.text}` : f.clause.text,
    clauseId: f.clause.id,
    quote: quoteOf(f.clause.text)
  }));

  const matches: FunctionMatch[] = matchRows.map((m, i) => ({
    id: `m${i + 1}`,
    status: m.status,
    beforeId: m.fn?.uid,
    afterIds: m.after.map((a) => a.uid),
    explanation: m.explanation,
    confidence: m.confidence
  }));

  // --- потоки функций между подразделениями
  const flowMap = new Map<string, UnitFlow>();
  const touched = new Map<string, { in: number; out: number; lost: number; narrowed: number }>();
  const bump = (key: string, k: 'in' | 'out' | 'lost' | 'narrowed') => {
    const t = touched.get(key) ?? { in: 0, out: 0, lost: 0, narrowed: 0 };
    t[k]++;
    touched.set(key, t);
  };
  for (const m of matchRows) {
    if (!m.fn) continue;
    if (m.status === 'lost') m.fn.holders.forEach((h) => bump(h.key, 'lost'));
    if (m.status === 'narrowed') m.fn.holders.forEach((h) => bump(h.key, 'narrowed'));
    if (!m.after.length) continue;
    const afterHolders = [...new Map(m.after.flatMap((a) => a.holders).map((h) => [h.key, h])).values()];
    for (const b of m.fn.holders) {
      for (const a of afterHolders) {
        const kind = a.key === b.key ? 'retained' : m.fn.holders.some((h) => h.key === a.key) ? null : 'transferred';
        if (!kind) continue;
        if (kind === 'transferred') {
          bump(b.key, 'out');
          bump(a.key, 'in');
        }
        const id = `${b.key}→${a.key}`;
        const flow = flowMap.get(id) ?? { from: unitId(b.key), to: unitId(a.key), kind, functionCount: 0, evidence: [] };
        flow.functionCount++;
        if (kind === 'transferred' && flow.evidence.length < 4) flow.evidence.push(ev(m.fn.clause), ev(m.after[0].clause));
        flowMap.set(id, flow);
      }
    }
  }
  const flows = [...flowMap.values()];

  // --- подразделения
  const keys = [...new Set([...structure.before, ...structure.after].map((u) => u.key))];
  const units: UnitChange[] = keys.map((key) => {
    const b = structure.before.find((u) => u.key === key);
    const a = structure.after.find((u) => u.key === key);
    const u = (a ?? b)!;
    const t = touched.get(key) ?? { in: 0, out: 0, lost: 0, narrowed: 0 };
    const posB = b?.positions ?? [];
    const posA = a?.positions ?? [];
    const pb = new Set(posB.map((p) => normPosition(p, u)));
    const pa = new Set(posA.map((p) => normPosition(p, u)));
    const posChanged = pb.size !== pa.size || [...pb].some((p) => !pa.has(p));
    const status = !b ? 'created' : !a ? 'removed' : posChanged || t.in || t.out || t.lost || t.narrowed ? 'reorganized' : 'retained';

    const receivedFrom = flows.filter((f) => f.to === unitId(key) && f.kind === 'transferred');
    const gaveTo = flows.filter((f) => f.from === unitId(key) && f.kind === 'transferred');
    const label = (id: string) => [...structure.before, ...structure.after].find((x) => unitId(x.key) === id)?.abbr ?? id.replace(/^u-/, '');
    const parts: string[] = [];
    if (status === 'created') parts.push('Создано');
    if (status === 'removed') parts.push(u.kind === 'position' ? 'Должность упразднена' : 'Упразднено');
    if (status === 'retained') parts.push('Сохранено без изменений');
    if (status === 'reorganized') parts.push('Сохранено с изменениями');
    if (receivedFrom.length) parts.push(`получило функции от: ${receivedFrom.map((f) => `${label(f.from)} (${f.functionCount})`).join(', ')}`);
    if (gaveTo.length) parts.push(`передало функции: ${gaveTo.map((f) => `${label(f.to)} (${f.functionCount})`).join(', ')}`);
    if (posChanged && b && a) parts.push('изменён состав должностей');
    if (t.lost) parts.push(`утрачено функций: ${t.lost}`);

    const evidence: Evidence[] = [];
    for (const x of [b, a]) {
      if (!x) continue;
      const c = clauseOf(x.side, docOf(parsed, x), x.clauseId);
      if (c) evidence.push(ev(c, x.quote));
      if (x.positionsClauseId) {
        const pc = clauseOf(x.side, docOf(parsed, x), x.positionsClauseId);
        if (pc) evidence.push(ev(pc));
      }
    }
    return {
      id: unitId(key),
      name: u.name,
      abbr: u.abbr,
      kind: u.kind,
      status,
      summary: parts.join('; '),
      positions: { before: posB, after: posA },
      evidence
    };
  });

  // --- выводы
  const lostByUnit = new Map(keys.map((k) => [unitId(k), touched.get(k)?.lost ?? 0]));
  const raw: Omit<Finding, 'id'>[] = [];
  for (const u of units) {
    if (u.status === 'retained') continue;
    const kind = u.status === 'created' ? 'unit_created' : u.status === 'removed' ? 'unit_removed' : 'unit_reorganized';
    const noun = u.kind === 'position' ? 'должность' : 'подразделение';
    const title =
      kind === 'unit_created'
        ? `Создано ${noun}: ${u.name}${u.abbr ? ` (${u.abbr})` : ''}`
        : kind === 'unit_removed'
          ? `Упразднено ${noun}: ${u.name}`
          : `Признаки реорганизации: ${u.name}${u.abbr ? ` (${u.abbr})` : ''}`;
    const flowEv = flows
      .filter((f) => f.kind === 'transferred' && (f.from === u.id || f.to === u.id))
      .flatMap((f) => f.evidence)
      .slice(0, 4);
    raw.push({
      kind,
      severity: kind === 'unit_removed' && lostByUnit.get(u.id) ? 'high' : 'medium',
      title,
      detail: `${u.summary}.${u.positions.before.length || u.positions.after.length ? ` Должности до: ${u.positions.before.join(', ') || '—'}; после: ${u.positions.after.join(', ') || '—'}.` : ''}`,
      unitIds: [u.id],
      evidence: [...u.evidence, ...flowEv],
      confidence: 0.9
    });
  }

  for (const m of matchRows) {
    if (!m.fn || (m.status !== 'lost' && m.status !== 'narrowed')) continue;
    const holders = m.fn.holders.map((h) => unitId(h.key));
    const who = holderLabel(m.fn);
    if (m.status === 'lost') {
      raw.push({
        kind: 'function_lost',
        severity: 'high',
        title: `Признаки утраты функции (${who}): «${clip(m.fn.clause.text, 90)}»`,
        detail: `В новой редакции не найден пункт, покрывающий функцию п. ${m.fn.clause.id} прежней редакции. ${m.explanation}`,
        unitIds: holders,
        evidence: [ev(m.fn.clause)],
        confidence: m.confidence,
        recommendation: 'Проверить, должна ли функция сохраниться, и при необходимости закрепить её за профильным подразделением.'
      });
    } else {
      raw.push({
        kind: 'function_narrowed',
        severity: 'medium',
        title: `Признаки сужения функции (${who}): п. ${m.fn.clause.id}`,
        detail: `${m.explanation}${m.lostPart ? ` Утраченная часть: «${m.lostPart}».` : ''}`,
        unitIds: [...new Set([...holders, ...m.after.flatMap((a) => a.holders.map((h) => unitId(h.key)))])],
        evidence: [ev(m.fn.clause, m.lostPart && quoteInText(m.lostPart, m.fn.clause.text) ? m.lostPart : undefined), ...m.after.slice(0, 2).map((a) => ev(a.clause))],
        confidence: m.confidence
      });
    }
  }

  for (const { v, p } of dupFindings) {
    const dup = v.verdict === 'duplication';
    raw.push({
      kind: dup ? 'function_duplicated' : 'responsibility_overlap',
      severity: dup ? 'high' : 'medium',
      title: `${dup ? 'Признаки дублирования' : 'Пересечение зон ответственности'}: ${holderLabel(p.a)} и ${holderLabel(p.b)}`,
      detail: v.explanation,
      unitIds: [...new Set([...p.a.holders, ...p.b.holders].map((h) => unitId(h.key)))],
      evidence: [ev(p.a.clause), ev(p.b.clause)],
      confidence: v.confidence,
      recommendation: v.recommendation || undefined
    });
  }

  for (const c of coi) {
    const evidence = c.refs
      .map((r) => {
        const f = afterRef.get(r.ref);
        return f ? ev(f.clause, r.quote) : null;
      })
      .filter((e): e is Evidence => !!e);
    const holderIds = structure.after
      .filter((u) => c.holders.some((h) => norm(h) === norm(u.name) || h === u.abbr))
      .map((u) => unitId(u.key));
    raw.push({
      kind: 'conflict_of_interest',
      severity: c.severity,
      title: c.title,
      detail: `${c.detail} (правило ${c.rule})`,
      unitIds: holderIds,
      evidence,
      confidence: c.confidence,
      recommendation: c.recommendation || undefined
    });
  }

  // Ограничение 9 ТЗ: вывод без подтверждённой цитаты не показывается.
  const kept = raw.filter((f) => f.evidence.length > 0 && f.evidence.some((e) => e.verified));
  const order = { high: 0, medium: 1, low: 2 } as const;
  const kindOrder = ['unit_removed', 'unit_created', 'unit_reorganized', 'function_lost', 'function_narrowed', 'function_duplicated', 'responsibility_overlap', 'conflict_of_interest'];
  const findings: Finding[] = kept
    .sort((a, b) => kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind) || order[a.severity] - order[b.severity])
    .map((f, i) => ({ ...f, id: `F${i + 1}` }));

  return { units, flows, functions, matches, findings, dropped: raw.length - kept.length };
}

const docOf = (parsed: Record<DocSide, ParsedClause[]>, u: UnitDef) =>
  parsed[u.side].find((c) => c.id === u.clauseId)?.docName ?? '';

