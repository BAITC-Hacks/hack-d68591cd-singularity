/**
 * Проверка качества пайплайна (п. 11 ТЗ: «нашёл ли агент известные изменения и указал ли верные источники»).
 *
 * 1. Эталон по тестовой паре организатора (ред. 8 → ред. 9): ключевые случаи из ручной экспертной разметки.
 * 2. Контрольный комплект с заранее известными изменениями: ред. 9 мутируется детерминированно —
 *    удаляется функция (обучение работников), одна функция дублируется в другой департамент, ДККМ переименовывается в ДМК.
 *    Мутированный документ сохраняется в data/control/ — его можно загрузить и через интерфейс.
 *
 *   bun run eval             — проверка
 *   bun run eval --prune     — ещё и удалить из data/cache ответы, не нужные текущим промптам
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { analyze } from '../src/features/orgdiff/lib/analyze';
import { demoDocs } from '../src/features/orgdiff/lib/jobs';
import { usedCacheFiles } from '../src/features/orgdiff/lib/llm';
import type { AnalysisResult, DocSide, Finding, UnitChange, UnitFlow } from '../src/features/orgdiff/types';

let passed = 0;
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  ok ? passed++ : failed++;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const cites = (f: Finding, side: 'before' | 'after', clause: string) =>
  f.evidence.some((e) => e.side === side && (e.clauseId === clause || e.clauseId.startsWith(`${clause}.`)));
const findingWith = (r: AnalysisResult, kinds: Finding['kind'][], side: 'before' | 'after', clause: string) =>
  r.findings.find((f) => kinds.includes(f.kind) && cites(f, side, clause));
const unit = (r: AnalysisResult, label: string) => r.units.find((u) => u.abbr === label || u.name === label);
const flow = (r: AnalysisResult, from: string, to: string) =>
  r.flows.find((f) => f.from === unit(r, from)?.id && f.to === unit(r, to)?.id && f.kind === 'transferred');
const citationRate = (r: AnalysisResult) => {
  const ev = r.findings.flatMap((f) => f.evidence);
  return ev.filter((e) => e.verified).length / (ev.length || 1);
};

// ---------------------------------------------------------------- 1. Эталон
console.log('\n1. Тестовая пара организатора: ред. 8 → ред. 9 (эталон — data/control/GOLD.md)');
const docs = await demoDocs();
const base = await analyze(docs);

check('G01 создан ДИТААД', unit(base, 'ДИТААД')?.status === 'created');
check('G02 создан ДОА', unit(base, 'ДОА')?.status === 'created');
check('G03 упразднена должность «Директор направления ВА»', unit(base, 'Директор направления внутреннего аудита')?.status === 'removed');
check('G04 функции директора направления → ДИТААД и ДОА', !!flow(base, 'Директор направления внутреннего аудита', 'ДИТААД') && !!flow(base, 'Директор направления внутреннего аудита', 'ДОА'));
check('G08 ДККМ реорганизован (штат 4 → 2)', unit(base, 'ДККМ')?.status === 'reorganized');
check('G11 Карта гарантий: ДНМ → ДИТААД/ДОА', !!flow(base, 'ДНМ', 'ДИТААД'));
check('G12 потеря: ДККМ формировать группы контроля качества (п. 5.6.2)', !!findingWith(base, ['function_lost'], 'before', '5.6.2'));
check('G13 потеря: ДККМ предложения по внешней оценке (п. 5.6.3)', !!findingWith(base, ['function_lost'], 'before', '5.6.3'));
check('G14 потеря: ДНМ результаты консультаций (п. 5.7.2)', !!findingWith(base, ['function_lost'], 'before', '5.7.2'));
check('G21 дублирование анализа непрерывного аудита (пп. 5.3.8 / 5.4.5)', !!base.findings.find((f) => ['function_duplicated', 'responsibility_overlap'].includes(f.kind) && cites(f, 'after', '5.3.8') && cites(f, 'after', '5.4.5')));
check('G29 конфликт интересов: Главный аудитор в органах управления ДЗО (п. 4.4)', !!findingWith(base, ['conflict_of_interest'], 'after', '4.4'));
check('Все цитаты найдены в текстах пунктов', citationRate(base) === 1, `${(citationRate(base) * 100).toFixed(0)}%`);

// ---------------------------------------------------------------- 2. Контрольный комплект
console.log('\n2. Контрольный комплект с известными изменениями (data/control/after_red9_control.txt)');
let text = readFileSync('data/after_polozhenie_red9.txt', 'utf-8').replace(/\r\n/g, '\n');
const mutate = (from: string | RegExp, to: string) => {
  const next = text.replace(from, to);
  if (next === text) throw new Error(`Мутация не применилась: ${from}`);
  text = next;
};
// C1. Потеря функции: у ДККМ удалено обучение работников БВА (в ред. 8 — п. 5.5.9).
mutate(/^5\.5\.6\. организует обучение работников БВА.*\n/m, '');
// C2. Дублирование: ДНМ получает оценку качества внутреннего аудита, которая уже есть у ДККМ (п. 5.5.2).
mutate(
  /^(5\.4\.10\. осуществляет выполнение прочих поручений Главного аудитора\.)$/m,
  '$1\n5.4.11. организует периодические внутренние и внешние оценки качества деятельности внутреннего аудита;'
);
// C3. Реорганизация: ДККМ преобразован в Департамент методологии и качества (ДМК).
mutate('Департамент контроля качества аудита и методологии (ДККМ)', 'Департамент методологии и качества (ДМК)');
mutate('Директор департамента контроля качества аудита и методологии (далее Директор ДККМ)', 'Директор департамента методологии и качества (далее Директор ДМК)');
text = text.replaceAll('ДККМ', 'ДМК');

mkdirSync('data/control', { recursive: true });
writeFileSync('data/control/after_red9_control.txt', text);
const control = await analyze([
  docs[0],
  { side: 'after', name: 'after_red9_control.txt', buffer: Buffer.from(text, 'utf-8') }
]);

check('C1 потеря функции: обучение работников БВА (до п. 5.5.9)', !!findingWith(control, ['function_lost'], 'before', '5.5.9'));
check(
  'C2 дублирование: оценка качества у ДНМ (п. 5.4.11) и ДМК (п. 5.5.2)',
  !!control.findings.find((f) => ['function_duplicated', 'responsibility_overlap'].includes(f.kind) && cites(f, 'after', '5.4.11'))
);
check(
  'C3 реорганизация: ДККМ → ДМК',
  unit(control, 'ДККМ')?.status === 'removed' &&
    unit(control, 'ДМК')?.status === 'created' &&
    !!control.findings.find((f) => f.kind === 'unit_reorganized' && f.unitIds.includes(unit(control, 'ДККМ')!.id))
);
check('Все цитаты найдены в текстах пунктов', citationRate(control) === 1, `${(citationRate(control) * 100).toFixed(0)}%`);

// ---------------------------------------------------------------- 3. Полнота по эталону
// Информационная метрика: считается по уже полученному результату base (без новых вызовов LLM)
// и не влияет на код выхода — он по-прежнему определяется 16 проверками выше.
console.log('\n3. Полнота по эталону (data/control/gold.json, результат тестовой пары)');

interface GoldItem {
  id: string;
  type: string;
  title: string;
  confidence: 'high' | 'medium' | 'low';
  likely_test_case: boolean;
  before_clauses: string[];
  after_clauses: string[];
}
type Hit = 'found' | 'partial' | 'missed' | 'na';

const gold = JSON.parse(readFileSync('data/control/gold.json', 'utf-8')) as GoldItem[];
const label = (id: string) => {
  const u = base.units.find((x) => x.id === id);
  return u?.abbr ?? u?.name ?? id;
};

/**
 * Ключевые пункты вывода эталона: сторона + номер. У потери функции — только «до»: в «после» её нет,
 * а пункты «после» в эталоне лишь показывают, где её искали.
 */
const keyRefs = (g: GoldItem) => [
  ...g.before_clauses.map((id) => ({ side: 'before' as const, id })),
  ...(g.type === 'function_lost' ? [] : g.after_clauses.map((id) => ({ side: 'after' as const, id })))
];
/** «5.3.2» ~ «5.3.2.а» в обе стороны: пункт и его буквенный подпункт. «5.6» и «5.6.2» — разные пункты. */
const subItem = (a: string, b: string) => a.startsWith(`${b}.`) && /^[^\d.]+$/.test(a.slice(b.length + 1));
const sameClause = (a: string, b: string) => a === b || subItem(a, b) || subItem(b, a);
const refersTo = (refs: { side: DocSide; clauseId: string }[], g: GoldItem) =>
  keyRefs(g).some((k) => refs.some((e) => e.side === k.side && sameClause(e.clauseId, k.id)));

/** Пункты потока: его evidence + пункты всех функций, давших ребро (matchIds). */
const fnById = new Map(base.functions.map((f) => [f.id, f]));
const flowRefs = (fl: UnitFlow) => {
  const refs: { side: DocSide; clauseId: string }[] = [...fl.evidence];
  for (const m of base.matches.filter((x) => fl.matchIds?.includes(x.id))) {
    for (const id of [m.beforeId, ...m.afterIds]) {
      const fn = id ? fnById.get(id) : undefined;
      if (fn) refs.push({ side: fn.side, clauseId: fn.clauseId });
    }
  }
  return refs;
};

const findingsOf = (g: GoldItem, ...kinds: Finding['kind'][]) =>
  base.findings.filter((f) => kinds.includes(f.kind) && refersTo(f.evidence, g)).map((f) => `${f.id}:${f.kind}`);
const unitsOf = (g: GoldItem, pred: (u: UnitChange) => boolean) =>
  base.units.filter((u) => pred(u) && refersTo(u.evidence, g)).map((u) => `${label(u.id)}:${u.status}`);
const transferredOf = (g: GoldItem) =>
  base.flows.filter((fl) => fl.kind === 'transferred' && refersTo(flowRefs(fl), g)).map((fl) => `${label(fl.from)}→${label(fl.to)}`);
const samePositions = (u: UnitChange) => [...u.positions.before].sort().join('|') === [...u.positions.after].sort().join('|');
const subordinationChanged = (u: UnitChange) =>
  (u.status === 'reorganized' || u.status === 'retained') && (u.parentId?.before !== u.parentId?.after || !samePositions(u));

/** Таблица соответствия: тип эталона → что пайплайн должен выдать; partial — засчитывается как «частично». */
const MATCHERS: Record<string, (g: GoldItem) => { full: string[]; partial?: string[] }> = {
  unit_created: (g) => ({ full: [...findingsOf(g, 'unit_created'), ...unitsOf(g, (u) => u.status === 'created')] }),
  unit_abolished: (g) => ({ full: [...findingsOf(g, 'unit_removed'), ...unitsOf(g, (u) => u.status === 'removed')] }),
  unit_transformed: (g) => ({ full: [...findingsOf(g, 'unit_reorganized'), ...unitsOf(g, (u) => u.status === 'reorganized')] }),
  unit_renamed: (g) => ({ full: [...findingsOf(g, 'unit_reorganized'), ...unitsOf(g, (u) => u.status === 'reorganized')] }),
  function_moved: (g) => ({ full: [...transferredOf(g), ...findingsOf(g, 'unit_reorganized')] }),
  function_lost: (g) => ({ full: findingsOf(g, 'function_lost'), partial: findingsOf(g, 'function_narrowed') }),
  function_narrowed: (g) => ({ full: findingsOf(g, 'function_narrowed', 'function_lost') }),
  duplication: (g) => ({ full: findingsOf(g, 'function_duplicated', 'responsibility_overlap') }),
  overlap: (g) => ({ full: findingsOf(g, 'responsibility_overlap', 'function_duplicated') }),
  conflict_of_interest: (g) => ({ full: findingsOf(g, 'conflict_of_interest') }),
  doc_defect: (g) => ({ full: findingsOf(g, 'doc_defect') }),
  subordination_change: (g) => ({ full: [...unitsOf(g, subordinationChanged), ...findingsOf(g, 'unit_reorganized')] })
};

const assess = (g: GoldItem): { hit: Hit; by: string[] } => {
  const m = MATCHERS[g.type]?.(g);
  if (!m) return { hit: 'na', by: [] };
  if (m.full.length) return { hit: 'found', by: m.full };
  if (m.partial?.length) return { hit: 'partial', by: m.partial };
  return { hit: 'missed', by: [] };
};
const assessed = gold.map((g) => ({ g, ...assess(g) }));

const MARK: Record<Hit, string> = { found: '✓ найдено    ', partial: '≈ частично   ', missed: '✗ не найдено ', na: '— не оценив. ' };
console.log('  ID   К  увер.   результат      тип эталона            чем подтверждено');
for (const { g, hit, by } of assessed.filter((a) => a.g.likely_test_case || a.g.confidence === 'high')) {
  const byText = by.length > 2 ? `${by.slice(0, 2).join(', ')} … (+${by.length - 2})` : by.join(', ');
  console.log(
    `  ${g.id}  ${g.likely_test_case ? 'К' : ' '}  ${g.confidence.padEnd(6)}  ${MARK[hit]}  ${g.type.padEnd(21)}  ${byText || g.title.slice(0, 60)}`
  );
}

const recallLine = (name: string, rows: typeof assessed) => {
  const scored = rows.filter((r) => r.hit !== 'na');
  const n = (h: Hit) => scored.filter((r) => r.hit === h).length;
  const pct = (x: number) => `${((x / (scored.length || 1)) * 100).toFixed(0)}%`;
  const na = rows.length - scored.length;
  console.log(
    `  ${name}: найдено ${n('found')}/${scored.length} = ${pct(n('found'))}` +
      ` (с частичными ${n('found') + n('partial')}/${scored.length} = ${pct(n('found') + n('partial'))})` +
      `; не найдено ${n('missed')}${na ? `; не оцениваются ${na} (типы без аналога в пайплайне)` : ''}`
  );
};
console.log('\n  Полнота (recall, К — вероятный контрольный случай):');
recallLine('вероятные контрольные случаи', assessed.filter((a) => a.g.likely_test_case));
recallLine('все выводы с уверенностью high', assessed.filter((a) => a.g.confidence === 'high'));
recallLine('все выводы эталона (справочно)', assessed);

if (process.argv.includes('--prune')) {
  let removed = 0;
  for (const kind of ['llm', 'emb']) {
    const dir = path.join(process.cwd(), 'data', 'cache', kind);
    for (const f of readdirSync(dir)) {
      if (usedCacheFiles.has(path.join(dir, f))) continue;
      rmSync(path.join(dir, f));
      removed++;
    }
  }
  console.log(`\nКэш: удалено устаревших файлов — ${removed}`);
}

console.log(`\nИтого: ${passed}/${passed + failed} проверок пройдено`);
process.exit(failed ? 1 : 0);
