/**
 * Проверка качества пайплайна (п. 11 ТЗ: «нашёл ли агент известные изменения и указал ли верные источники»).
 *
 * 1. Эталон по тестовой паре организатора (ред. 8 → ред. 9): ключевые случаи из ручной экспертной разметки.
 * 2. Контрольный комплект с заранее известными изменениями: ред. 9 мутируется детерминированно —
 *    удаляется функция, одна функция дублируется в другой департамент, ДККМ переименовывается в ДМК.
 *    Мутированный документ сохраняется в data/control/ — его можно загрузить и через интерфейс.
 *
 *   bun run eval
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { analyze } from '../src/features/orgdiff/lib/analyze';
import { demoDocs } from '../src/features/orgdiff/lib/jobs';
import type { AnalysisResult, Finding } from '../src/features/orgdiff/types';

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
// C1. Потеря функции: у ДККМ удалена разработка методологии (в ред. 8 — п. 5.5.6).
mutate(/^5\.5\.4\. разрабатывает методические материалы.*\n/m, '');
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

check('C1 потеря функции: разработка методологии (до п. 5.5.6)', !!findingWith(control, ['function_lost'], 'before', '5.5.6'));
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

console.log(`\nИтого: ${passed}/${passed + failed} проверок пройдено`);
process.exit(failed ? 1 : 0);
