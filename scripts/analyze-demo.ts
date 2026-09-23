/**
 * Прогон пайплайна на тестовом комплекте из data/ без запуска сервера.
 *   bun scripts/analyze-demo.ts            — вывод сводки
 *   bun scripts/analyze-demo.ts --mock     — ещё и пересобрать src/features/orgdiff/mock.json для интерфейса
 */
import { writeFileSync } from 'fs';
import { analyze } from '../src/features/orgdiff/lib/analyze';
import { demoDocs } from '../src/features/orgdiff/lib/jobs';
import { FINDING_KIND_LABELS } from '../src/features/orgdiff/types';

const printed = new Set<string>();
const result = await analyze(await demoDocs(), (trace) => {
  for (const s of trace) {
    if ((s.status !== 'done' && s.status !== 'error') || printed.has(s.id)) continue;
    printed.add(s.id);
    console.log(`  ${s.status === 'done' ? '✓' : '✗'} ${s.label}${s.detail ? ` — ${s.detail}` : ''} (${((s.finishedAt! - s.startedAt) / 1000).toFixed(1)}с)`);
  }
});

console.log(`\nПодразделения:`);
for (const u of result.units) console.log(`  [${u.status}] ${u.abbr ?? u.name} — ${u.summary}`);
console.log(`\nПотоки функций:`);
for (const f of result.flows.filter((f) => f.kind === 'transferred')) console.log(`  ${f.from} → ${f.to}: ${f.functionCount}`);
console.log(`\nВыводы (${result.findings.length}):`);
for (const f of result.findings) {
  console.log(`  ${f.id} [${FINDING_KIND_LABELS[f.kind]}, ${f.severity}, ${f.confidence}] ${f.title}`);
  for (const e of f.evidence.slice(0, 3)) console.log(`      ${e.verified ? '✓' : '✗'} ${e.side === 'before' ? 'до' : 'после'} п. ${e.clauseId}: «${e.quote.slice(0, 100)}»`);
}
console.log(`\nЗаключение: ${result.conclusion.summary}`);
console.log(`\n${result.meta.durationMs} мс, модель ${result.meta.model}, из кэша: ${result.meta.fromCache}`);

if (process.argv.includes('--mock')) {
  writeFileSync('src/features/orgdiff/mock.json', JSON.stringify(result, null, 2));
  console.log('mock.json обновлён');
}
