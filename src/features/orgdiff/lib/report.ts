import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} from 'docx';
import type { AnalysisResult, Evidence, Finding, FindingKind, Severity, UnitStatus } from '../types';
import { FINDING_KIND_LABELS } from '../types';

/**
 * Итоговое заключение документом (must have 5 ТЗ): то же содержание, что в интерфейсе,
 * но в виде, который сотрудник может приложить к служебной записке. У каждого вывода —
 * документ, пункт и дословная цитата.
 */

const STATUS: Record<UnitStatus, string> = {
  created: 'Создано',
  retained: 'Сохранено',
  reorganized: 'Реорганизовано',
  removed: 'Упразднено'
};
const SEVERITY: Record<Severity, string> = { high: 'высокая', medium: 'средняя', low: 'низкая' };
const KIND_ORDER: FindingKind[] = [
  'unit_removed',
  'unit_created',
  'unit_reorganized',
  'function_lost',
  'function_narrowed',
  'function_duplicated',
  'responsibility_overlap',
  'conflict_of_interest'
];

const docLabel = (r: AnalysisResult, side: 'before' | 'after') =>
  r.documents
    .filter((d) => d.side === side)
    .map((d) => d.title ?? d.name)
    .join('; ');

const shortOf = (r: AnalysisResult, e: Evidence) => {
  const d = r.documents.find((x) => x.side === e.side && x.name === e.docName);
  return d?.short ?? (e.side === 'before' ? 'до' : 'после');
};

const sourceLine = (r: AnalysisResult, e: Evidence) => `${shortOf(r, e)}, п. ${e.clauseId}: «${e.quote}»`;

const grouped = (r: AnalysisResult) =>
  KIND_ORDER.map((kind) => ({ kind, items: r.findings.filter((f) => f.kind === kind) })).filter((g) => g.items.length);

const findingMeta = (f: Finding) =>
  `Серьёзность: ${SEVERITY[f.severity]}; уверенность: ${Math.round(f.confidence * 100)}%`;

// ---------------------------------------------------------------- Markdown

export function reportMarkdown(r: AnalysisResult): string {
  const out: string[] = [];
  out.push('# Заключение по анализу организационной структуры и функционала', '');
  out.push(`**Документы «до»:** ${docLabel(r, 'before')}  `);
  out.push(`**Документы «после»:** ${docLabel(r, 'after')}  `);
  out.push(`**Сформировано:** ${new Date(r.meta.generatedAt).toLocaleString('ru-RU')} · модель ${r.meta.model}`, '');
  out.push(`> ${r.conclusion.disclaimer}`, '');

  out.push('## 1. Краткое резюме', '', r.conclusion.summary, '');

  out.push('## 2. Изменения структуры', '', '| Подразделение / должность | Статус | Что изменилось |', '|---|---|---|');
  for (const u of r.units) {
    out.push(`| ${u.name}${u.abbr ? ` (${u.abbr})` : ''} | ${STATUS[u.status]} | ${u.summary} |`);
  }
  out.push('');

  out.push('## 3. Аналитическое заключение', '');
  for (const s of r.conclusion.sections) {
    out.push(`### ${s.title}`, '', s.text, '');
    if (s.findingIds.length) out.push(`_Основание: ${s.findingIds.join(', ')}_`, '');
  }

  out.push('## 4. Рекомендации', '');
  r.conclusion.recommendations.forEach((x, i) =>
    out.push(`${i + 1}. ${x.text}${x.findingIds.length ? ` _(${x.findingIds.join(', ')})_` : ''}`)
  );
  out.push('');

  out.push('## 5. Выводы с источниками', '');
  for (const g of grouped(r)) {
    out.push(`### ${FINDING_KIND_LABELS[g.kind]} — ${g.items.length}`, '');
    for (const f of g.items) {
      out.push(`**${f.id}. ${f.title}**  `, `${findingMeta(f)}  `, f.detail, '');
      for (const e of f.evidence) out.push(`- ${sourceLine(r, e)}`);
      if (f.recommendation) out.push('', `Рекомендация: ${f.recommendation}`);
      if (f.caveat) out.push('', `Требует проверки: ${f.caveat}`);
      out.push('');
    }
  }

  const s = r.stats;
  out.push(
    '## 6. Сводка',
    '',
    `Пунктов: до — ${s.clausesBefore}, после — ${s.clausesAfter}. Подразделений: создано — ${s.unitsCreated}, упразднено — ${s.unitsRemoved}, реорганизовано — ${s.unitsReorganized}, без изменений — ${s.unitsRetained}. Потерянных функций: ${s.functionsLost}. Выводов: ${s.findings}.`,
    ''
  );
  return out.join('\n');
}

// ---------------------------------------------------------------- DOCX

const p = (text: string, opts: { bold?: boolean; italic?: boolean; size?: number } = {}) =>
  new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text, ...opts })] });
const h = (text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]) =>
  new Paragraph({ heading: level, spacing: { before: 240, after: 120 }, children: [new TextRun(text)] });
const bullet = (text: string) => new Paragraph({ bullet: { level: 0 }, spacing: { after: 60 }, children: [new TextRun(text)] });

const cell = (text: string, bold = false) =>
  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, bold, size: 20 })] })] });

export async function reportDocx(r: AnalysisResult): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [];
  children.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      children: [new TextRun('Заключение по анализу организационной структуры и функционала')]
    }),
    p(`Документы «до»: ${docLabel(r, 'before')}`),
    p(`Документы «после»: ${docLabel(r, 'after')}`),
    p(`Сформировано: ${new Date(r.meta.generatedAt).toLocaleString('ru-RU')} · модель ${r.meta.model}`),
    p(r.conclusion.disclaimer, { italic: true })
  );

  children.push(h('1. Краткое резюме', HeadingLevel.HEADING_1), p(r.conclusion.summary));

  children.push(
    h('2. Изменения структуры', HeadingLevel.HEADING_1),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
        bottom: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
        left: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
        right: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
        insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
        insideVertical: { style: BorderStyle.SINGLE, size: 1, color: '999999' }
      },
      rows: [
        new TableRow({ tableHeader: true, children: [cell('Подразделение / должность', true), cell('Статус', true), cell('Что изменилось', true)] }),
        ...r.units.map(
          (u) => new TableRow({ children: [cell(`${u.name}${u.abbr ? ` (${u.abbr})` : ''}`), cell(STATUS[u.status]), cell(u.summary)] })
        )
      ]
    })
  );

  children.push(h('3. Аналитическое заключение', HeadingLevel.HEADING_1));
  for (const s of r.conclusion.sections) {
    children.push(h(s.title, HeadingLevel.HEADING_2), p(s.text));
    if (s.findingIds.length) children.push(p(`Основание: ${s.findingIds.join(', ')}`, { italic: true, size: 18 }));
  }

  children.push(h('4. Рекомендации', HeadingLevel.HEADING_1));
  r.conclusion.recommendations.forEach((x, i) =>
    children.push(p(`${i + 1}. ${x.text}${x.findingIds.length ? ` (${x.findingIds.join(', ')})` : ''}`))
  );

  children.push(h('5. Выводы с источниками', HeadingLevel.HEADING_1));
  for (const g of grouped(r)) {
    children.push(h(`${FINDING_KIND_LABELS[g.kind]} — ${g.items.length}`, HeadingLevel.HEADING_2));
    for (const f of g.items) {
      children.push(p(`${f.id}. ${f.title}`, { bold: true }), p(findingMeta(f), { italic: true, size: 18 }), p(f.detail));
      for (const e of f.evidence) children.push(bullet(sourceLine(r, e)));
      if (f.recommendation) children.push(p(`Рекомендация: ${f.recommendation}`));
      if (f.caveat) children.push(p(`Требует проверки: ${f.caveat}`, { italic: true }));
    }
  }

  const s = r.stats;
  children.push(
    h('6. Сводка', HeadingLevel.HEADING_1),
    p(
      `Пунктов: до — ${s.clausesBefore}, после — ${s.clausesAfter}. Подразделений: создано — ${s.unitsCreated}, упразднено — ${s.unitsRemoved}, реорганизовано — ${s.unitsReorganized}, без изменений — ${s.unitsRetained}. Потерянных функций: ${s.functionsLost}. Выводов: ${s.findings}.`
    )
  );

  const doc = new Document({
    creator: 'OrgDiff',
    title: 'Заключение по анализу оргструктуры',
    styles: { default: { document: { run: { font: 'Arial', size: 22 } } } },
    sections: [{ children }]
  });
  return Packer.toBuffer(doc);
}
