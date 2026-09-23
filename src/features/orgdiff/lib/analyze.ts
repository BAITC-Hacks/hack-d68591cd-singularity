import { createHash } from 'crypto';
import type {
  AnalysisResult,
  ComplianceItem,
  DocSide,
  Evidence,
  EvidencePair,
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
  judgeComparability,
  judgeDuplicates,
  suggestRecipients,
  judgeMatches,
  recheckLosses,
  writeConclusion,
  type MatchVerdict
} from './judge';
import { embed, llmStats, MODEL } from './llm';
import { checkCompliance } from './compliance';
import { detectJurisdiction } from './jurisdiction';
import { findRefDefects } from './defects';
import { extractTables, extractText, isTableFile } from './load-doc';
import { parseClauses, parseTable, toPublicClause, type ParsedClause } from './parse-clauses';
import { clip, cosine, jaccard, norm, quoteInText } from './text';
import { docHead, docOwner, extractStructure, normPosition, unitKey, type DocHead, type UnitDef } from './units';

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

/** План шагов агента: интерфейс показывает его целиком сразу после запуска. */
export const PIPELINE_STEPS = [
  { id: 'parse', label: 'Чтение документов и разбор на пункты' },
  { id: 'structure', label: 'Определение состава подразделений' },
  { id: 'functions', label: 'Извлечение функций и их носителей' },
  { id: 'align', label: 'Выравнивание неизменённых пунктов' },
  { id: 'embed', label: 'Семантические векторы пунктов' },
  { id: 'relevance', label: 'Проверка сопоставимости комплектов «до» и «после»' },
  { id: 'match', label: 'ИИ-сопоставление изменённых функций' },
  { id: 'recheck', label: 'Самопроверка потерь по всему документу' },
  { id: 'duplicates', label: 'Поиск дублирования и пересечения функций' },
  { id: 'conflicts', label: 'Поиск конфликта интересов (каталог правил IIA/SoD)' },
  { id: 'redistribute', label: 'Рекомендации по перераспределению утраченных функций' },
  { id: 'assemble', label: 'Проверка цитат и сборка выводов' },
  { id: 'conclusion', label: 'Итоговое аналитическое заключение' },
  { id: 'compliance', label: 'Сверка с внешними требованиями (IIA + законодательство по юрисдикции документов)' }
] as const;

export const pendingTrace = (): TraceStep[] =>
  PIPELINE_STEPS.map((s) => ({ ...s, status: 'pending', startedAt: 0 }));

/** Шапка документа: «ПОЛОЖЕНИЕ О … (редакция No9) от «23» декабря 2022» → название и «ред. 9». */
export function docMeta(text: string): { title?: string; short?: string } {
  const head = text.slice(0, 2000);
  const lines = head.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const red = head.match(/редакци[яи]\s*(?:No|№)?\s*(\d+)/iu);
  const date = head.match(/от\s*«(\d{1,2})»\s*(\p{L}+)\s*(\d{4})/u);
  const i = lines.findIndex((l) => /^(ПОЛОЖЕНИЕ|ПОЛИТИКА|РЕГЛАМЕНТ|ИНСТРУКЦИЯ|ПРИКАЗ|СТРУКТУРА|ДОЛЖНОСТНАЯ)/u.test(l));
  const short = red ? `ред. ${red[1]}` : undefined;
  if (i < 0) return { short };
  // Вторая строка названия («О ВНУТРЕННЕМ АУДИТЕ …»), но не первый пункт документа («1. Общие положения»).
  const next = lines[i + 1] && !/^(?:\d|от\s)/iu.test(lines[i + 1]) ? lines[i + 1] : '';
  const raw = [lines[i], next].join(' ').replace(/\(редакция[^)]*\)/iu, '').trim();
  const words = raw.split(/\s+/).map((w, k) => (w.length >= 4 && w === w.toUpperCase() ? w.toLowerCase() : k > 0 && w.length === 1 ? w.toLowerCase() : w));
  const title = words.join(' ').replace(/^\p{L}/u, (c) => c.toUpperCase());
  return { title: `${title}${short ? `, ${short}` : ''}${date ? ` от ${date[1]} ${date[2]} ${date[3]} г.` : ''}`, short };
}

export async function analyze(docs: DocInput[], onProgress?: ProgressFn): Promise<AnalysisResult> {
  const t0 = Date.now();
  const callsBefore = llmStats.calls;
  const hitsBefore = llmStats.cacheHits;
  const trace = pendingTrace();
  const meta = new Map<string, { title?: string; short?: string }>();
  const heads = new Map<string, DocHead>();

  // Метка документа в тексте для LLM — только если на стороне несколько документов (однодокументный промпт не меняется).
  const docTag = (side: DocSide, docName: string) =>
    docs.filter((d) => d.side === side).length > 1 ? ` (${meta.get(`${side}:${docName}`)?.short ?? docName})` : '';

  const step = async <T>(id: string, label: string, fn: () => Promise<T>, detail?: (r: T) => string): Promise<T> => {
    let s = trace.find((x) => x.id === id);
    if (!s) trace.push((s = { id, label, status: 'pending', startedAt: 0 }));
    s.status = 'running';
    s.startedAt = Date.now();
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
        if (isTableFile(d.name)) {
          // Таблица оргструктуры/штатного расписания: строка = пункт с адресом «стр. N».
          out[d.side].push(...parseTable(await extractTables(d.buffer), d.side, d.name));
          meta.set(`${d.side}:${d.name}`, {});
          continue;
        }
        const text = await extractText(d.buffer, d.name);
        meta.set(`${d.side}:${d.name}`, docMeta(text));
        heads.set(`${d.side}:${d.name}`, docHead(text));
        out[d.side].push(...parseClauses(text, d.side, d.name));
      }
      for (const side of ['before', 'after'] as const) {
        if (!out[side].length) {
          throw new Error(`Не удалось выделить пункты в документах «${side === 'before' ? 'до' : 'после'}»: нужен текст с нумерацией пунктов или таблица оргструктуры`);
        }
      }
      return out;
    },
    (r) => `до: ${r.before.length} пунктов, после: ${r.after.length} пунктов`
  );

  // Реквизиты «до» и «после» совпали (две версии без номера редакции) — различаем стороны явно.
  const shortsOf = (side: DocSide) => docs.filter((d) => d.side === side).map((d) => meta.get(`${side}:${d.name}`)?.short ?? '').join('|');
  if (shortsOf('before') === shortsOf('after')) {
    for (const d of docs) {
      const m = meta.get(`${d.side}:${d.name}`) ?? {};
      const tag = d.side === 'before' ? 'до' : 'после';
      meta.set(`${d.side}:${d.name}`, {
        title: m.title ? `${m.title} (${tag})` : undefined,
        short: m.short ? `${m.short} (${tag})` : tag
      });
    }
  }

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

  // 3. Функции с носителями. В комплекте из нескольких документов «Положение о Департаменте …» и
  // «Должностная инструкция …» дают носителя по умолчанию, а пункты приказа — поручения, не функции.
  const docCtx = (side: DocSide) => {
    const owners = new Map<string, UnitDef>();
    const orders = new Set<string>();
    for (const d of docs.filter((x) => x.side === side)) {
      const head = heads.get(`${side}:${d.name}`) ?? {};
      if (head.kind === 'order') orders.add(d.name);
      const owner = docOwner(head, structure[side]);
      if (owner) owners.set(d.name, owner);
    }
    return { owners, orders };
  };
  const ctx = { before: docCtx('before'), after: docCtx('after') };
  const fns = await step(
    'functions',
    'Извлечение функций и их носителей',
    async () => ({
      before: buildFunctions(parsed.before, structure.before, 'before', ctx.before),
      after: buildFunctions(parsed.after, structure.after, 'after', ctx.after)
    }),
    (r) => {
      const owned = [...ctx.before.owners, ...ctx.after.owners].map(([doc, u]) => `${doc} → ${u.abbr ?? u.name}`);
      return `до: ${r.before.length}, после: ${r.after.length}${owned.length ? `; носитель по шапке: ${owned.join(', ')}` : ''}`;
    }
  );
  labelDocs(docs, meta, heads, ctx);

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

  // 5б. Сопоставимы ли комплекты: иначе анализ не проводится (ошибка загрузки, разные подразделения и т.п.).
  await step(
    'relevance',
    'Проверка сопоставимости комплектов «до» и «после»',
    async () => {
      const afterVecs = afterAll.map((f) => vectors.get(f.uid)).filter((v): v is number[] => !!v);
      let covered = exact.size;
      for (const f of changedBefore) {
        const v = vectors.get(f.uid);
        if (v && afterVecs.some((a) => cosine(v, a) >= RELEVANCE_COS)) covered++;
      }
      const total = fns.before.length;
      const exactShare = total ? exact.size / total : 0;
      const coverage = total ? covered / total : 0;
      const afterKeys = new Set(structure.after.map((u) => u.key));
      const sharedUnits = structure.before.filter((u) => afterKeys.has(u.key)).length;
      const signals = `дословно совпало ${Math.round(exactShare * 100)}% функций, по смыслу покрыто ${Math.round(coverage * 100)}%, общих подразделений: ${sharedUnits}`;

      if (exactShare >= 0.15 || coverage >= 0.45 || (sharedUnits > 0 && coverage >= 0.25)) return `сопоставимы: ${signals}`;
      const verdict =
        coverage < 0.15 && sharedUnits === 0
          ? { comparable: false, reason: `Документы почти не пересекаются по содержанию (${signals}).` }
          : await judgeComparability(setSummary(parsed.before, structure.before, meta), setSummary(parsed.after, structure.after, meta));
      if (verdict.comparable) return `сопоставимы по оценке ИИ: ${verdict.reason} (${signals})`;
      throw new IncomparableError(
        `Комплекты «до» и «после» нельзя сравнить: ${verdict.reason.replace(/\.$/, '')}. Загрузите документы одного и того же подразделения (структуры) до и после реорганизации.`
      );
    },
    (r) => r
  );

  const score = (a: Fn, b: Fn) => cosine(vectors.get(a.uid)!, vectors.get(b.uid)!) + 0.3 * jaccard(a.clause.text, b.clause.text);
  // Кандидат того же носителя получает бонус: типовые обязанности есть у всех руководителей,
  // и без бонуса модель может сопоставить функцию ДНМ с такой же строкой другого департамента.
  const topK = (f: Fn, pool: Fn[], k: number) =>
    pool
      .map((c) => ({ c, s: score(f, c) + (sameHolders(f, c) ? 0.08 : 0) }))
      .sort((x, y) => y.s - x.s)
      .slice(0, k)
      .map((x) => x.c);

  // 6. LLM: сопоставление изменённых функций
  const afterRef = new Map(afterAll.map((f) => [f.ref, f]));
  const beforeRef = new Map(fns.before.map((f) => [f.ref, f]));
  // Внутренние ссылки промптов («A118», «B85») → номера пунктов, понятные пользователю.
  const humanize = (text: string) =>
    text.replace(/(?<![\p{L}\d])([AB])(\d+)(?![\p{L}\d])/gu, (m, side: string, n: string) => {
      const f = (side === 'A' ? afterRef : beforeRef).get(`${side}${n}`);
      if (!f) return m;
      const short = meta.get(`${f.side}:${f.clause.docName}`)?.short ?? (f.side === 'before' ? 'до' : 'после');
      return `п. ${f.clause.id} (${short})`;
    });
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
        // Частичное покрытие общими нормами не снимает вывод о потере: конкретное право/обязанность исчезли.
        v.verdict = c.verdict === 'covered' ? 'same' : 'lost';
        v.partialLoss = c.verdict === 'partially';
        v.afterRefs = c.afterRefs;
        v.explanation = `Перепроверка: ${c.explanation}`;
        v.confidence = c.confidence;
      }
      return revised;
    },
    (r) => `проверено: ${lostFns.length}, пересмотрено: ${r}`
  );

  // Опция 3 ТЗ: кому передать утраченную функцию — подразделение «после», чьи функции ближе всего по смыслу.
  const recipients = (f: Fn): Recipient[] => {
    const v = vectors.get(f.uid);
    if (!v) return [];
    // Только собственные функции подразделения: общие для всех пункты и типовые обязанности выбор не различают.
    const scored = new Map<string, { unit: UnitDef; hits: { clause: Fn; s: number }[] }>();
    for (const a of fns.after) {
      const va = vectors.get(a.uid);
      if (!va || a.holders.length > 2 || GENERIC_DUTY.test(a.clause.text)) continue;
      const s = cosine(v, va);
      for (const h of a.holders) {
        const cur = scored.get(h.key) ?? { unit: h, hits: [] };
        cur.hits.push({ clause: a, s });
        scored.set(h.key, cur);
      }
    }
    return [...scored.values()]
      .map(({ unit, hits }) => {
        const top = hits.sort((x, y) => y.s - x.s).slice(0, 2);
        return { unit, clause: top[0].clause, score: top.reduce((n, h) => n + h.s, 0) / top.length };
      })
      .sort((x, y) => y.score - x.score)
      .slice(0, 2);
  };

  // 8. Сборка таблицы сопоставления функций
  const beforeFnById = new Map(fns.before.map((f) => [f.uid, f]));
  const matchRows: MatchRow[] = [];
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
      lostPart: v?.lostPart,
      partialLoss: v?.partialLoss
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
          // Подпункты одного перечня («5.3.2.а … (ДИТААД)», «5.3.2.б … (ДОА)») — это само разделение предметов, а не пересечение.
          if (a.clause.parentId && a.clause.parentId === b.clause.parentId && a.clause.docName === b.clause.docName) continue;
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
        fns.after.filter((f) => /цел|задач|функци|прав|обязанност|взаимоотношени|дзо|дочерн/iu.test(f.clause.sectionTitle)),
        afterAll.filter((f) => /конфликт|КИ\b|независим|совмещ|объективн/iu.test(f.clause.text))
      ),
    (r) => `кандидатов: ${r.length}`
  );

  // 10б. Кому передать утраченные функции: LLM выбирает по собственным функциям подразделений, код проверяет ссылки.
  const lostNow = matchRows.filter((m) => m.status === 'lost' && m.fn).map((m) => m.fn!);
  const suggestions = await step(
    'redistribute',
    'Рекомендации по перераспределению утраченных функций',
    async () => {
      const units = structure.after
        .map((u) => ({
          unit: u,
          label: u.abbr ?? u.name,
          fns: fns.after.filter((f) => f.holders.length <= 2 && f.holders.some((h) => h.key === u.key) && !GENERIC_DUTY.test(f.clause.text)).slice(0, 40)
        }))
        .filter((u) => u.fns.length);
      const raw = await suggestRecipients(lostNow, units);
      const out = new Map<string, Recipient & { reason: string }>();
      for (const s of raw) {
        const u = units.find((x) => x.label === s.recipient.trim());
        const clause = u?.fns.find((f) => f.ref === s.afterRef);
        if (u && clause) out.set(s.ref, { unit: u.unit, clause, score: 1, reason: s.reason });
      }
      return out;
    },
    (r) => `утраченных функций: ${lostNow.length}, рекомендаций: ${r.size}`
  );

  // 11. Сборка результата с проверкой каждой цитаты
  const assembled = await step(
    'assemble',
    'Проверка цитат и сборка выводов',
    async () =>
      assemble({
        parsed,
        structure,
        fns,
        matchRows,
        dupFindings,
        coi,
        afterRef,
        humanize,
        recipients: (f) => {
          const s = suggestions.get(f.ref);
          return s ? [s, ...recipients(f).filter((r) => r.unit.key !== s.unit.key)] : recipients(f);
        },
        reasons: (f) => suggestions.get(f.ref)?.reason
      }),
    (r) => `выводов: ${r.findings.length}; отброшено без подтверждённой цитаты: выводов ${r.dropped}, цитат ${r.unverified}`
  );

  // 12. Итоговое заключение
  const conclusion = await step(
    'conclusion',
    'Итоговое аналитическое заключение',
    async () => {
      const digest = assembled.findings
        .map(
          (f) =>
            `${f.id} [${f.origin === 'preexisting' ? 'было ранее' : 'новое'}; ${f.kind}, ${f.severity}] ${f.title}. ${clip(f.detail, 700)}${f.recommendation ? ` Рекомендация вывода: ${clip(f.recommendation, 300)}` : ''} Источники: ${f.evidence.map((e) => `${e.side === 'before' ? 'до' : 'после'}${docTag(e.side, e.docName)} п. ${e.clauseId}`).join(', ')}`
        )
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

  // 13. Опция 1 ТЗ: сверка новой редакции с внешними требованиями. Ошибка шага не валит анализ.
  let compliance: ComplianceItem[] = [];
  const jurisdiction = detectJurisdiction([...parsed.before, ...parsed.after]);
  try {
    compliance = await step(
      'compliance',
      'Сверка с внешними требованиями (IIA + законодательство по юрисдикции документов)',
      () => checkCompliance(parsed.after, jurisdiction.applicable),
      (r) => {
        const n = (st: ComplianceItem['status']) => r.filter((x) => x.status === st).length;
        return `юрисдикция: ${jurisdiction.applicable.join(' + ')}; требований: ${r.length}; выполнено ${n('met')}, частично ${n('partial')}, не выполнено ${n('not_met')}, противоречит ${n('contradicts')}, не найдено ${n('no_evidence')}`;
      }
    );
  } catch {
    // статус 'error' и текст ошибки уже записаны в trace шагом step()
  }

  const units = assembled.units;
  return {
    documents: docs.map((d) => ({
      side: d.side,
      name: d.name,
      clauseCount: parsed[d.side].filter((c) => c.docName === d.name).length,
      ...meta.get(`${d.side}:${d.name}`)
    })),
    clauses: [...parsed.before, ...parsed.after].map(toPublicClause),
    units,
    flows: assembled.flows,
    functions: assembled.functions,
    matches: assembled.matches,
    findings: assembled.findings,
    conclusion,
    compliance,
    jurisdiction,
    trace,
    stats: {
      clausesBefore: parsed.before.length,
      clausesAfter: parsed.after.length,
      unitsCreated: units.filter((u) => u.status === 'created').length,
      unitsRemoved: units.filter((u) => u.status === 'removed').length,
      unitsReorganized: units.filter((u) => u.status === 'reorganized').length,
      unitsRetained: units.filter((u) => u.status === 'retained').length,
      functionsLost: assembled.matches.filter((m) => m.status === 'lost').length,
      findings: assembled.findings.length,
      findingsNew: assembled.findings.filter((f) => f.origin !== 'preexisting').length
    },
    meta: {
      model: MODEL,
      generatedAt: new Date().toISOString(),
      resultId: resultIdOf(docs),
      durationMs: Date.now() - t0,
      fromCache: llmStats.calls - callsBefore > 0 && llmStats.cacheHits - hitsBefore === llmStats.calls - callsBefore
    }
  };
}

// ---------------------------------------------------------------------------------------------

interface MatchRow {
  id?: string;
  fn?: Fn;
  after: Fn[];
  status: MatchStatus;
  explanation: string;
  confidence: number;
  lostPart?: string;
  partialLoss?: boolean;
}

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
  // Номер пункта мог повториться в нескольких документах стороны — берём пункт, где цитата действительно есть.
  const pick = (id: string, quote: string) => {
    const cs = clauses.filter((c) => c.id === id.replace(/^п\.\s*/u, '').trim());
    return cs.find((c) => quoteInText(quote, c.text)) ?? cs[0];
  };
  const seen = new Set<string>();
  return found
    .map((u) => ({ u, c: pick(u.clauseId, u.quote) }))
    .filter(({ u, c }) => {
      const key = unitKey(u.name, u.abbr || undefined);
      if (!c || !u.name.trim() || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(({ u, c }) => {
      return {
        key: unitKey(u.name, u.abbr || undefined),
        name: u.name,
        abbr: u.abbr || undefined,
        kind: u.kind,
        side,
        docName: c.docName,
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
  matchRows: MatchRow[];
  dupFindings: { v: { verdict: string; explanation: string; recommendation: string; confidence: number }; p: { a: Fn; b: Fn } }[];
  coi: { title: string; detail: string; rule: string; holders: string[]; refs: { ref: string; quote: string }[]; severity: 'high' | 'medium' | 'low'; confidence: number; recommendation: string }[];
  afterRef: Map<string, Fn>;
  humanize: (text: string) => string;
  recipients: (f: Fn) => Recipient[];
  reasons: (f: Fn) => string | undefined;
}

interface Recipient {
  unit: UnitDef;
  clause: Fn;
  score: number;
}

/** Ниже этого сходства «ближайшее» подразделение — случайное, рекомендовать его нельзя. */
const RECIPIENT_MIN_SCORE = 0.45;

/** Типовые обязанности, которые есть у каждого руководителя: их совпадение — не содержательный дубль. */
const GENERIC_DUTY =
  /по всему кругу вопросов|прочих поручений|профессионального уровня|запрашива\p{L}* у Руководителей Общества информаци|в разработке ВНД|в разработке проектов документации/iu;

function assemble({ parsed, structure, fns, matchRows, dupFindings, coi, afterRef, humanize, recipients, reasons }: AssembleInput) {
  // Какие формулировки у каких носителей были в прежней редакции — для «новое / было ранее» и честных передач.
  const beforeText = new Map<string, Set<string>>();
  for (const f of fns.before) {
    const k = norm(f.clause.text);
    const set = beforeText.get(k) ?? new Set<string>();
    f.holders.forEach((h) => set.add(h.key));
    if (!f.holders.length) set.add('');
    beforeText.set(k, set);
  }
  const hadBefore = (a: Fn, holderKey: string) => beforeText.get(norm(a.clause.text))?.has(holderKey) ?? false;
  const existedBefore = (a: Fn) => a.holders.length ? a.holders.every((h) => hadBefore(a, h.key)) : beforeText.has(norm(a.clause.text));
  const clauseExistedBefore = (c: ParsedClause) => parsed.before.some((b) => norm(b.text) === norm(c.text));
  for (const m of matchRows) m.explanation = humanize(m.explanation);
  const clauseOf = (side: DocSide, docName: string, id: string) =>
    parsed[side].find((c) => c.docName === docName && c.id === id);

  // --- функции (публичная форма)
  const functions: UnitFunction[] = [...fns.before, ...fns.after].map((f) => ({
    id: f.uid,
    side: f.side,
    unitIds: f.holders.map((h) => unitId(h.key)),
    docName: f.clause.docName,
    text: f.context ? `${f.context.replace(/:$/, '')}: ${f.clause.text}` : f.clause.text,
    clauseId: f.clause.id,
    quote: quoteOf(f.clause.text)
  }));

  matchRows.forEach((m, i) => (m.id = `m${i + 1}`));
  const matches: FunctionMatch[] = matchRows.map((m) => ({
    id: m.id!,
    status: m.status,
    beforeId: m.fn?.uid,
    afterIds: m.after.map((a) => a.uid),
    explanation: m.explanation,
    confidence: m.confidence
  }));

  // --- потоки функций между подразделениями
  const flowMap = new Map<string, UnitFlow>();
  const flowPairs = new Map<string, EvidencePair[]>();
  const touched = new Map<string, { in: number; out: number; lost: number; narrowed: number }>();
  const bump = (key: string, k: 'in' | 'out' | 'lost' | 'narrowed') => {
    const t = touched.get(key) ?? { in: 0, out: 0, lost: 0, narrowed: 0 };
    t[k]++;
    touched.set(key, t);
  };
  // Функцию X «покрывает» только пункт другого носителя, который был у него и прежде:
  // полное совпадение — у X снят дубль; частичное — у X функция утрачена (прежний пункт Y её лишь частично перекрывает).
  for (const m of matchRows) {
    // «Сужение», при котором утрачено ≥ 70% формулировки, — это потеря функции (частично покрытая).
    if (m.fn && m.status === 'narrowed' && m.lostPart && norm(m.lostPart).length >= 0.7 * norm(m.fn.clause.text).length) {
      m.status = 'lost';
      m.partialLoss = true;
      m.explanation = `Утрачена основная часть функции: «${m.lostPart}». ${m.explanation}`;
      continue;
    }
    if (!m.fn || !m.after.length || !['moved', 'narrowed', 'expanded'].includes(m.status)) continue;
    const own = (a: Fn) => a.holders.some((h) => m.fn!.holders.some((x) => x.key === h.key));
    if (!m.after.every((a) => !own(a) && existedBefore(a))) continue;
    const x = holderLabel(m.fn);
    const y = holderLabel(m.after[0]);
    if (m.status === 'narrowed') {
      m.status = 'lost';
      m.partialLoss = true;
      m.explanation = `У ${x} функция снята; прежний пункт ${y} перекрывает её лишь частично. ${m.explanation}`;
    } else {
      m.status = 'kept';
      m.explanation = `Функция по-прежнему выполняется ${y} (была у него и в прежней редакции); у ${x} формулировка снята — вероятно, устранено дублирование.`;
    }
  }

  for (const m of matchRows) {
    if (!m.fn) continue;
    if (m.status === 'lost') m.fn.holders.forEach((h) => bump(h.key, 'lost'));
    if (m.status === 'narrowed') m.fn.holders.forEach((h) => bump(h.key, 'narrowed'));
    // Утраченная функция никуда не передана: частичное покрытие — не поток.
    if (!m.after.length || m.status === 'lost') continue;
    // Передача X → Y засчитывается, только если у Y этой функции прежде не было: иначе у X снят дубль.
    const afterHolders = [
      ...new Map(m.after.flatMap((a) => a.holders.filter((h) => !hadBefore(a, h.key))).map((h) => [h.key, h])).values(),
      ...m.after.flatMap((a) => a.holders).filter((h) => m.fn!.holders.some((x) => x.key === h.key))
    ];

    for (const b of m.fn.holders) {
      for (const a of afterHolders) {
        const kind = a.key === b.key ? 'retained' : m.fn.holders.some((h) => h.key === a.key) ? null : 'transferred';
        if (!kind) continue;
        if (kind === 'transferred') {
          bump(b.key, 'out');
          bump(a.key, 'in');
        }
        const id = `${b.key}→${a.key}`;
        const flow = flowMap.get(id) ?? { from: unitId(b.key), to: unitId(a.key), kind, functionCount: 0, evidence: [], matchIds: [] };
        flow.functionCount++;
        flow.matchIds!.push(m.id!);
        if (kind === 'transferred' && flow.evidence.length < 4) flow.evidence.push(ev(m.fn.clause), ev(m.after[0].clause));
        if (kind === 'transferred') {
          const fp = flowPairs.get(id) ?? [];
          if (fp.length < 8) fp.push({ before: ev(m.fn.clause), after: ev(m.after[0].clause), note: `${holderLabel(m.fn)} → ${holderLabel(m.after[0])}` });
          flowPairs.set(id, fp);
        }
        flowMap.set(id, flow);
      }
    }
  }
  const flows = [...flowMap.values()];
  // Статусы строк могли уточниться (снятый дубль → «сохранено») — синхронизируем таблицу.
  for (const mm of matches) {
    const row = matchRows.find((r) => r.id === mm.id)!;
    mm.status = row.status;
    mm.explanation = row.explanation;
  }

  // --- подразделения
  const keys = [...new Set([...structure.before, ...structure.after].map((u) => u.key))];
  const unitPairs = new Map<string, EvidencePair[]>();
  // Преобразование/переименование: большая часть функций упразднённого подразделения ушла в одно новое.
  const beforeKeys = new Set(structure.before.map((u) => u.key));
  const afterKeys = new Set(structure.after.map((u) => u.key));
  const transformedInto = new Map<string, string>();
  for (const key of keys) {
    if (!beforeKeys.has(key) || afterKeys.has(key)) continue;
    // Преемник — новое подразделение, получившее заметно больше функций, чем любое другое
    // (общие для всех департаментов пункты размазывают потоки, поэтому сравниваем с вторым, а не с суммой).
    const [top, second] = flows
      .filter((f) => f.from === unitId(key) && f.kind === 'transferred')
      .toSorted((a, b) => b.functionCount - a.functionCount);
    const target = top && [...afterKeys].find((k) => unitId(k) === top.to && !beforeKeys.has(k));
    if (target && (!second || top.functionCount >= 1.5 * second.functionCount)) transformedInto.set(unitId(key), target);
  }
  const labelOfKey = (k: string) => {
    const x = structure.after.find((y) => y.key === k);
    return x ? (x.abbr ?? x.name) : k;
  };
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
    // «Реорганизовано» — только изменение состава/штата; изменение одних функций — «сохранено, изменён функционал».
    const status = !b ? 'created' : !a ? 'removed' : posChanged ? 'reorganized' : 'retained';

    const receivedFrom = flows.filter((f) => f.to === unitId(key) && f.kind === 'transferred');
    const gaveTo = flows.filter((f) => f.from === unitId(key) && f.kind === 'transferred');
    const label = (id: string) => {
      const x = [...structure.before, ...structure.after].find((y) => unitId(y.key) === id);
      return x ? (x.abbr ?? x.name) : id.replace(/^u-/, '');
    };
    const parts: string[] = [];
    if (status === 'created') parts.push('Создано');
    const into = transformedInto.get(unitId(key));
    if (status === 'removed') parts.push(into ? `Преобразовано в ${labelOfKey(into)}` : u.kind === 'position' ? 'Должность упразднена' : 'Упразднено');
    if (status === 'retained') parts.push(t.in || t.out || t.lost || t.narrowed ? 'Сохранено, изменён функционал' : 'Сохранено без изменений');
    if (status === 'reorganized') parts.push('Сохранено с изменениями');
    if (receivedFrom.length) parts.push(`получило функции от: ${receivedFrom.map((f) => `${label(f.from)} (${f.functionCount})`).join(', ')}`);
    if (gaveTo.length) parts.push(`передало функции: ${gaveTo.map((f) => `${label(f.to)} (${f.functionCount})`).join(', ')}`);
    if (posChanged && b && a) parts.push('изменён состав должностей');
    if (t.lost) parts.push(`утрачено функций: ${t.lost}`);

    const evidence: Evidence[] = [];
    const nameEv: Partial<Record<DocSide, Evidence>> = {};
    const posEv: Partial<Record<DocSide, Evidence>> = {};
    for (const x of [b, a]) {
      if (!x) continue;
      const c = clauseOf(x.side, x.docName, x.clauseId);
      if (c) evidence.push((nameEv[x.side] = ev(c, x.quote)));
      if (x.positionsClauseId) {
        const pc = clauseOf(x.side, x.docName, x.positionsClauseId);
        if (pc) evidence.push((posEv[x.side] = ev(pc)));
      }
    }
    const pairs: EvidencePair[] = [{ before: nameEv.before, after: nameEv.after, note: 'наименование в структуре' }];
    if (posEv.before || posEv.after) pairs.push({ before: posEv.before, after: posEv.after, note: 'состав должностей' });
    unitPairs.set(unitId(key), pairs);
    const parentB = b && parentUnit(b, structure.before);
    const parentA = a && parentUnit(a, structure.after);
    return {
      parentId: parentB || parentA ? { before: parentB && unitId(parentB.key), after: parentA && unitId(parentA.key) } : undefined,
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
    const pos = u.kind === 'position';
    const title =
      kind === 'unit_created'
        ? `${pos ? 'Введена должность' : 'Создано подразделение'}: ${u.name}${u.abbr ? ` (${u.abbr})` : ''}`
        : kind === 'unit_removed'
          ? `${pos ? 'Упразднена должность' : 'Упразднено подразделение'}: ${u.name}${transformedInto.has(u.id) ? ` (функции переданы ${labelOfKey(transformedInto.get(u.id)!)})` : ''}`
          : `Признаки реорганизации: ${u.name}${u.abbr ? ` (${u.abbr})` : ''}`;
    const unitFlows = flows.filter((f) => f.kind === 'transferred' && (f.from === u.id || f.to === u.id));
    const flowEv = unitFlows.flatMap((f) => f.evidence).slice(0, 4);
    const pairsOfFlows = unitFlows.flatMap((f) => (flowPairs.get(flowKey(f)) ?? []).slice(0, 2)).slice(0, 6);
    raw.push({
      kind,
      severity: kind === 'unit_removed' && lostByUnit.get(u.id) && !transformedInto.has(u.id) ? 'high' : 'medium',
      title,
      detail: `${u.summary}.${u.positions.before.length || u.positions.after.length ? ` Должности до: ${u.positions.before.join(', ') || '—'}; после: ${u.positions.after.join(', ') || '—'}.` : ''}`,
      unitIds: [u.id],
      evidence: [...u.evidence, ...flowEv],
      pairs: [...(unitPairs.get(u.id) ?? []), ...pairsOfFlows],
      matchIds: unitFlows.flatMap((f) => f.matchIds ?? []),
      confidence: 0.9
    });
  }

  // Преобразование: функции упразднённого подразделения в основном ушли во вновь созданные.
  for (const r of units.filter((u) => u.status === 'removed')) {
    const out = flows.filter((f) => f.from === r.id && f.kind === 'transferred');
    const total = out.reduce((s, f) => s + f.functionCount, 0);
    const toCreated = out.filter(
      (f) => units.find((u) => u.id === f.to)?.status === 'created' && f.functionCount / (total || 1) >= 0.25
    );
    if (!toCreated.length) continue;
    const names = toCreated.map((f) => {
      const u = units.find((x) => x.id === f.to)!;
      return `${u.abbr ?? u.name} (${f.functionCount})`;
    });
    raw.push({
      kind: 'unit_reorganized',
      severity: 'medium',
      title: `Признаки преобразования: ${r.abbr ?? r.name} → ${toCreated
        .map((f) => {
          const u = units.find((x) => x.id === f.to)!;
          return u.abbr ?? u.name;
        })
        .join(', ')}`,
      detail: `Функции «${r.name}» перешли во вновь созданные подразделения: ${names.join(', ')} из ${total} переданных функций.`,
      unitIds: [r.id, ...toCreated.map((f) => f.to)],
      evidence: [...r.evidence.slice(0, 1), ...toCreated.flatMap((f) => f.evidence.slice(0, 2))],
      pairs: toCreated.flatMap((f) => (flowPairs.get(flowKey(f)) ?? []).slice(0, 3)),
      matchIds: toCreated.flatMap((f) => f.matchIds ?? []),
      confidence: 0.85
    });
  }

  for (const m of matchRows) {
    if (!m.fn || (m.status !== 'lost' && m.status !== 'narrowed')) continue;
    const holders = m.fn.holders.map((h) => unitId(h.key));
    const who = holderLabel(m.fn);
    if (m.status === 'lost') {
      const redis = redistribution(m.fn, recipients(m.fn), reasons(m.fn));
      raw.push({
        kind: 'function_lost',
        severity: 'high',
        title: `Признаки утраты функции (${who}): «${clip(m.fn.clause.text, 90)}»`,
        detail: m.partialLoss
          ? `Конкретная функция п. ${m.fn.clause.id} прежней редакции в новой не закреплена; найдено лишь частичное покрытие общими нормами. ${m.explanation}`
          : `В новой редакции не найден пункт, покрывающий функцию п. ${m.fn.clause.id} прежней редакции. ${m.explanation}`,
        unitIds: holders,
        evidence: [ev(m.fn.clause), ...m.after.slice(0, 2).map((a) => ev(a.clause))],
        pairs: [
          {
            before: ev(m.fn.clause),
            after: m.after[0] ? ev(m.after[0].clause) : undefined,
            note: m.partialLoss ? 'в новой редакции — лишь частичное покрытие общими нормами' : 'соответствия в новой редакции не найдено'
          },
          ...(redis.pairs ?? [])
        ],
        matchIds: [m.id!],
        confidence: m.confidence,
        recommendation: redis.recommendation
      });
    } else {
      raw.push({
        kind: 'function_narrowed',
        // Выпало одно-два слова («критериев», «и филиалов») — сигнал слабее, чем потеря целого действия.
        severity: m.lostPart && m.lostPart.length < 30 ? 'low' : 'medium',
        title: `Признаки сужения функции (${who}): п. ${m.fn.clause.id}`,
        detail: `${m.explanation}${m.lostPart ? ` Утраченная часть: «${m.lostPart}».` : ''}`,
        unitIds: [...new Set([...holders, ...m.after.flatMap((a) => a.holders.map((h) => unitId(h.key)))])],
        evidence: [ev(m.fn.clause, m.lostPart && quoteInText(m.lostPart, m.fn.clause.text) ? m.lostPart : undefined), ...m.after.slice(0, 2).map((a) => ev(a.clause))],
        pairs: [{ before: ev(m.fn.clause), after: m.after[0] && ev(m.after[0].clause), note: m.lostPart ? `убрано: «${m.lostPart}»` : undefined }],
        matchIds: [m.id!],
        confidence: m.confidence,
        recommendation:
          m.lostPart && m.after[0]
            ? `Проверить, намеренно ли из п. ${m.after[0].clause.id} убрано «${m.lostPart}»; если нет — вернуть формулировку п. ${m.fn.clause.id} прежней редакции.`
            : `Сверить объём функции с п. ${m.fn.clause.id} прежней редакции и при необходимости восстановить утраченную часть.`
      });
    }
  }

  for (const { v, p } of dupFindings) {
    const dup = v.verdict === 'duplication';
    const generic = GENERIC_DUTY.test(p.a.clause.text) && GENERIC_DUTY.test(p.b.clause.text);
    raw.push({
      origin: existedBefore(p.a) && existedBefore(p.b) ? 'preexisting' : 'new',
      kind: dup ? 'function_duplicated' : 'responsibility_overlap',
      severity: generic ? 'low' : dup ? 'high' : 'medium',
      title: `${dup ? 'Признаки дублирования' : 'Пересечение зон ответственности'}: ${holderLabel(p.a)} и ${holderLabel(p.b)} — «${clip(p.a.clause.text, 70)}»`,
      detail: humanize(v.explanation),
      unitIds: [...new Set([...p.a.holders, ...p.b.holders].map((h) => unitId(h.key)))],
      evidence: [ev(p.a.clause), ev(p.b.clause)],
      pairs: [
        { after: ev(p.a.clause), note: holderLabel(p.a) },
        { after: ev(p.b.clause), note: holderLabel(p.b) }
      ],
      caveat: generic
        ? 'Типовая обязанность руководителя, закреплённая за всеми подразделениями; вероятно, не требует устранения.'
        : p.a.holders.length > 1 || p.b.holders.length > 1
          ? 'Пункт закреплён сразу за несколькими носителями — распределение обязанностей между ними требует уточнения.'
          : undefined,
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
    const coiClauses = c.refs.map((r) => afterRef.get(r.ref)?.clause).filter((x): x is ParsedClause => !!x);
    raw.push({
      origin: coiClauses.length && coiClauses.every(clauseExistedBefore) ? 'preexisting' : 'new',
      kind: 'conflict_of_interest',
      severity: c.severity,
      title: c.title,
      detail: humanize(`${c.detail} (правило ${c.rule})`),
      unitIds: holderIds,
      evidence,
      pairs: evidence.map((e) => ({ after: e })),
      confidence: c.confidence,
      recommendation: c.recommendation || undefined
    });
  }

  // Дефекты перекрёстных ссылок новой редакции — детерминированно.
  for (const d of findRefDefects(parsed.before, parsed.after)) {
    const shifted = d.kind === 'shifted';
    raw.push({
      kind: 'doc_defect',
      severity: shifted ? 'medium' : 'low',
      title: shifted
        ? `Ссылка устарела после перенумерации: п. ${d.clause.id} ссылается на п. ${d.ref}`
        : `Ссылка на несуществующий пункт: п. ${d.clause.id} → п. ${d.ref}`,
      detail: shifted
        ? `Текст п. ${d.clause.id} не менялся, но по номеру п. ${d.ref} в новой редакции теперь другое содержание, а прежнее перенесено в п. ${d.movedTo!.id}. Смысл нормы искажается.`
        : `В новой редакции нет п. ${d.ref}, на который ссылается п. ${d.clause.id}.`,
      unitIds: [],
      evidence: [ev(d.clause), ...(d.target ? [ev(d.target)] : []), ...(d.beforeTarget ? [ev(d.beforeTarget)] : []), ...(d.movedTo ? [ev(d.movedTo)] : [])],
      pairs: shifted
        ? [
            { after: ev(d.clause), note: 'ссылающийся пункт (текст не менялся)' },
            { before: ev(d.beforeTarget!), after: ev(d.target!), note: `п. ${d.ref}: было → стало` },
            { before: ev(d.beforeTarget!), after: ev(d.movedTo!), note: `прежнее содержание теперь в п. ${d.movedTo!.id}` }
          ]
        : [{ after: ev(d.clause) }],
      confidence: shifted ? 0.85 : 0.9,
      recommendation: shifted ? `Заменить ссылку «п. ${d.ref}» на «п. ${d.movedTo!.id}».` : 'Исправить номер пункта в ссылке.'
    });
  }

  for (const f of raw) {
    f.origin ??= 'new';
    // Одна и та же пара «до → после» с разными пояснениями — показываем один раз, пояснения объединяем.
    if (f.pairs) {
      const byKey = new Map<string, EvidencePair>();
      for (const pr of f.pairs) {
        const k = `${pr.before?.side}:${pr.before?.docName}:${pr.before?.clauseId}|${pr.after?.side}:${pr.after?.docName}:${pr.after?.clauseId}`;
        const prev = byKey.get(k);
        if (!prev) byKey.set(k, { ...pr });
        else if (pr.note && prev.note !== pr.note) prev.note = [prev.note, pr.note].filter(Boolean).join('; ');
      }
      f.pairs = [...byKey.values()];
    }
    if (f.matchIds) f.matchIds = [...new Set(f.matchIds)];
    f.title = humanize(f.title);
    if (f.recommendation) f.recommendation = humanize(f.recommendation);
    const seen = new Set<string>();
    f.evidence = f.evidence.filter((e) => {
      const k = `${e.side}|${e.docName}|${e.clauseId}`;
      return seen.has(k) ? false : (seen.add(k), true);
    });
  }

  // Ограничение 9 ТЗ: неподтверждённые цитаты убираются, вывод без подтверждённых цитат не показывается.
  const unverified = raw.reduce((n, f) => n + f.evidence.filter((e) => !e.verified).length, 0);
  for (const f of raw) {
    f.evidence = f.evidence.filter((e) => e.verified);
    f.pairs = f.pairs
      ?.map((p) => ({ ...p, before: p.before?.verified ? p.before : undefined, after: p.after?.verified ? p.after : undefined }))
      .filter((p) => p.before || p.after);
  }
  const kept = raw.filter((f) => f.evidence.length > 0);
  const order = { high: 0, medium: 1, low: 2 } as const;
  const kindOrder = ['unit_removed', 'unit_created', 'unit_reorganized', 'function_lost', 'function_narrowed', 'function_duplicated', 'responsibility_overlap', 'conflict_of_interest', 'doc_defect'];
  const findings: Finding[] = kept
    .sort(
      (a, b) =>
        Number(a.origin === 'preexisting') - Number(b.origin === 'preexisting') ||
        kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind) ||
        order[a.severity] - order[b.severity]
    )
    .map((f, i) => ({ ...f, id: `F${i + 1}` }));

  return { units, flows, functions, matches, findings, dropped: raw.length - kept.length, unverified };
}

/**
 * Короткие метки документов («ред. 9», «Положение о ДНМ, ред. 2», «Приказ No 45») для ссылок «п. 3.1 (…)».
 * Нужны, только когда на стороне несколько документов: номера пунктов в них совпадают.
 */
function labelDocs(
  docs: DocInput[],
  meta: Map<string, { title?: string; short?: string }>,
  heads: Map<string, DocHead>,
  ctx: Record<DocSide, { owners: Map<string, UnitDef> }>
) {
  for (const side of ['before', 'after'] as const) {
    const sideDocs = docs.filter((d) => d.side === side);
    if (sideDocs.length < 2) continue;
    const labels = sideDocs.map((d) => {
      const m = meta.get(`${side}:${d.name}`) ?? {};
      const head = heads.get(`${side}:${d.name}`) ?? {};
      const owner = ctx[side].owners.get(d.name);
      const who = owner && (owner.abbr ?? owner.name);
      if (who && head.kind === 'job') return [`ДИ ${who}`, m.short].filter(Boolean).join(', ');
      if (who) return [`Положение о ${who}`, m.short].filter(Boolean).join(', ');
      if (head.kind === 'order') return `Приказ${m.title?.match(/No\s*\d+/u) ? ` ${m.title.match(/No\s*\d+/u)![0]}` : ''}`;
      return m.short ?? d.name.replace(/\.[^.]+$/, '');
    });
    sideDocs.forEach((d, i) => {
      const dup = labels.filter((l) => l === labels[i]).length > 1;
      const key = `${side}:${d.name}`;
      meta.set(key, { ...meta.get(key), short: dup ? `${labels[i]} (${d.name})` : labels[i] });
    });
  }
}

/** Стабильный id результата: хеш сторон, имён и содержимого документов. */
function resultIdOf(docs: DocInput[]): string {
  const h = createHash('sha256');
  for (const d of [...docs].sort((a, b) => `${a.side}${a.name}`.localeCompare(`${b.side}${b.name}`))) {
    h.update(`${d.side}\0${d.name}\0`).update(d.buffer);
  }
  return h.digest('hex').slice(0, 16);
}

/**
 * Рекомендация по перераспределению утраченной функции (опция 3 ТЗ): ближайший по смыслу носитель
 * в новой структуре с обоснованием — его пунктом. Детерминированно, по уже посчитанным эмбеддингам.
 */
function redistribution(fn: Fn, rs: Recipient[], reason?: string): Pick<Finding, 'recommendation' | 'pairs'> {
  const top = rs.filter((r) => r.score >= RECIPIENT_MIN_SCORE);
  if (!top.length) {
    return { recommendation: 'Явного получателя по смыслу в новой структуре нет: решение о закреплении функции — за руководителем блока.' };
  }
  const name = (u: UnitDef) => u.abbr ?? u.name;
  const [first, second] = top;
  const prev = fn.holders.map(name).join(', ');
  const same = fn.holders.some((h) => h.key === first.unit.key);
  const text =
    `Предлагаемый ответственный — ${name(first.unit)}${same ? ' (прежний носитель)' : prev ? ` (прежде — ${prev})` : ''}: ` +
    (reason ? `${reason.replace(/\.$/, '')} (п. ${first.clause.clause.id}).` : `в новой редакции ему ближе всего по смыслу п. ${first.clause.clause.id} «${clip(first.clause.clause.text, 90)}».`) +
    (second && !reason ? ` Альтернатива — ${name(second.unit)} (п. ${second.clause.clause.id}).` : '');
  return {
    recommendation: text,
    pairs: [
      { before: ev(fn.clause), after: ev(first.clause.clause), note: `ближайшая функция предлагаемого получателя — ${name(first.unit)}` }
    ]
  };
}

/** Порог смыслового совпадения пункта «до» с каким-либо пунктом «после» для проверки сопоставимости. */
const RELEVANCE_COS = 0.6;

/** Комплекты не относятся к одному объекту — анализ не проводится, пользователь получает объяснение. */
export class IncomparableError extends Error {
  readonly code = 'incomparable' as const;
}

/** Краткое описание комплекта для судьи сопоставимости: названия, разделы, состав, примеры пунктов. */
function setSummary(clauses: ParsedClause[], units: UnitDef[], meta: Map<string, { title?: string }>): string {
  const docs = [...new Set(clauses.map((c) => c.docName))];
  const titles = docs.map((d) => `«${meta.get(`${clauses.find((c) => c.docName === d)!.side}:${d}`)?.title ?? d}»`);
  const sections = [...new Set(clauses.map((c) => c.sectionTitle))].slice(0, 15);
  const samples = clauses
    .filter((c) => c.text.length > 60)
    .filter((_, i, arr) => i % Math.max(1, Math.floor(arr.length / 12)) === 0)
    .slice(0, 12)
    .map((c) => `— п. ${c.id}: ${clip(c.text, 160)}`);
  return [
    `Документы: ${titles.join('; ')}`,
    `Разделы: ${sections.join('; ')}`,
    `Подразделения: ${units.map((u) => u.abbr ?? u.name).join(', ') || 'не выделены'}`,
    'Примеры пунктов:',
    ...samples
  ].join('\n');
}

const flowKey = (f: UnitFlow) => `${f.from.replace(/^u-/, '')}→${f.to.replace(/^u-/, '')}`;

/** Руководитель подразделения/должности: владелец перечня, где есть «Директор <аббревиатура>» или сама должность. */
function parentUnit(u: UnitDef, all: UnitDef[]): UnitDef | undefined {
  const isHead = (item: string) => {
    if (u.kind === 'position') return norm(item) === norm(u.name);
    if (!u.abbr) return false;
    return /^(директор|руководитель|начальник)$/u.test(norm(item.replace(new RegExp(u.abbr, 'u'), '')));
  };
  return all.find((p) => p !== u && p.positions.some(isHead));
}


