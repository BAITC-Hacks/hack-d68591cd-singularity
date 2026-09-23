/**
 * Прогон пайплайна на произвольных файлах без сервера — для проверки на своём комплекте.
 *   bun scripts/analyze-files.ts --before a.pdf [--before b.docx] --after c.pdf [--after d.xlsx] [--json out.json]
 * Форматы: .docx, .pdf (скан без текста — через OCR), .png/.jpg (OCR), .xlsx, .txt. Новые документы требуют OPENAI_API_KEY (.env).
 */
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { analyze, type DocInput } from '../src/features/orgdiff/lib/analyze';
import { FINDING_KIND_LABELS, type Finding } from '../src/features/orgdiff/types';

const args = process.argv.slice(2);
const files: { side: 'before' | 'after'; file: string }[] = [];
let jsonOut: string | undefined;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if ((a === '--before' || a === '--after') && args[i + 1]) files.push({ side: a === '--before' ? 'before' : 'after', file: args[++i] });
  else if (a === '--json' && args[i + 1]) jsonOut = args[++i];
}
if (!files.some((f) => f.side === 'before') || !files.some((f) => f.side === 'after')) {
  console.error('Использование: bun scripts/analyze-files.ts --before <файл> [--before …] --after <файл> [--after …] [--json out.json]');
  process.exit(2);
}

const docs: DocInput[] = await Promise.all(
  files.map(async (f) => ({ side: f.side, name: path.basename(f.file), buffer: await readFile(f.file) }))
);

console.log('Ход анализа:');
const printed = new Set<string>();
const result = await analyze(docs, (trace) => {
  for (const s of trace) {
    if ((s.status !== 'done' && s.status !== 'error') || printed.has(s.id)) continue;
    printed.add(s.id);
    console.log(`  ${s.status === 'done' ? '✓' : '✗'} ${s.label}${s.detail ? ` — ${s.detail}` : ''} (${((s.finishedAt! - s.startedAt) / 1000).toFixed(1)}с)`);
  }
});

console.log('\nДокументы:');
for (const d of result.documents) console.log(`  [${d.side === 'before' ? 'до' : 'после'}] ${d.name}: ${d.clauseCount} пунктов${d.title ? ` — ${d.title}` : ''}`);

console.log('\nПодразделения:');
for (const u of result.units) {
  const src = u.evidence.map((e) => `${e.side === 'before' ? 'до' : 'после'} п. ${e.clauseId}`).join(', ');
  console.log(`  [${u.status}] ${u.abbr ? `${u.abbr} — ` : ''}${u.name} (${u.kind}): ${u.summary}${src ? ` [${src}]` : ''}`);
}

const transferred = result.flows.filter((f) => f.kind === 'transferred');
if (transferred.length) {
  console.log('\nПотоки функций:');
  for (const f of transferred) console.log(`  ${f.from} → ${f.to}: ${f.functionCount}`);
}

const byKind = new Map<Finding['kind'], Finding[]>();
for (const f of result.findings) byKind.set(f.kind, [...(byKind.get(f.kind) ?? []), f]);
console.log(`\nВыводы (${result.findings.length}):`);
for (const [kind, list] of byKind) {
  console.log(`  ${FINDING_KIND_LABELS[kind]} (${list.length}):`);
  for (const f of list) {
    const refs = f.evidence.map((e) => `${e.side === 'before' ? 'до' : 'после'} ${e.docName} п. ${e.clauseId}`).join('; ');
    console.log(`    ${f.id} [${f.severity}, ${f.confidence}] ${f.title}\n        ↳ ${refs}`);
  }
}

console.log(`\nЗаключение: ${result.conclusion.summary}`);
console.log(`\n${result.meta.durationMs} мс, модель ${result.meta.model}, из кэша: ${result.meta.fromCache}`);
if (jsonOut) {
  await writeFile(jsonOut, JSON.stringify(result, null, 2));
  console.log(`JSON: ${jsonOut}`);
}
