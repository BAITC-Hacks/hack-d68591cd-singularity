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
import type { AnalysisResult, ComplianceItem, Evidence, Finding, FindingKind, FindingReview, Severity, UnitStatus } from '../types';
import { COMPLIANCE_STATUS_LABELS, FINDING_KIND_LABELS } from '../types';

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
  'conflict_of_interest',
  'doc_defect'
];

const docLabel = (r: AnalysisResult, side: 'before' | 'after') =>
  r.documents
    .filter((d) => d.side === side)
    .map((d) => (d.title ? `${d.title} (файл ${d.name})` : d.name))
    .join('; ');

/** Реквизиты сторон совпадают — предупреждаем, что стороны определены по порядку загрузки. */
const sameRequisites = (r: AnalysisResult) => {
  const t = (side: 'before' | 'after') =>
    r.documents
      .filter((d) => d.side === side)
      .map((d) => (d.title ?? '').replace(/ \((до|после)\)$/, ''))
      .join('|');
  return t('before') !== '' && t('before') === t('after');
};
const SAME_REQUISITES_NOTE = 'Реквизиты документов «до» и «после» совпадают — стороны определены по порядку загрузки.';

const shortOf = (r: AnalysisResult, e: Evidence) => {
  const d = r.documents.find((x) => x.side === e.side && x.name === e.docName);
  return d?.short ?? (e.side === 'before' ? 'до' : 'после');
};

const sourceLine = (r: AnalysisResult, e: Evidence) =>
  `${e.side === 'before' ? 'ДО' : 'ПОСЛЕ'} · ${shortOf(r, e)}, п. ${e.clauseId}: «${e.quote}»`;

export type Reviews = Readonly<Record<string, FindingReview>>;

/** Отклонённые сотрудником выводы уходят в приложение, остальные — в основной перечень. */
const grouped = (r: AnalysisResult, reviews: Reviews) =>
  KIND_ORDER.map((kind) => ({
    kind,
    items: r.findings.filter((f) => f.kind === kind && reviews[f.id] !== 'rejected')
  })).filter((g) => g.items.length);

const rejectedOf = (r: AnalysisResult, reviews: Reviews) => r.findings.filter((f) => reviews[f.id] === 'rejected');

const reviewLine = (r: AnalysisResult, reviews: Reviews) => {
  const confirmed = r.findings.filter((f) => reviews[f.id] === 'confirmed').length;
  const rejected = rejectedOf(r, reviews).length;
  return `Проверено сотрудником: ${confirmed + rejected} из ${r.findings.length} выводов (подтверждено — ${confirmed}, отклонено — ${rejected}).`;
};

const reviewMark = (f: Finding, reviews: Reviews) => (reviews[f.id] === 'confirmed' ? ' — подтверждено сотрудником' : '');

const refsLabel = (ids: string[], reviews: Reviews) =>
  ids.map((id) => (reviews[id] === 'rejected' ? `${id} (отклонён)` : id)).join(', ');

const findingMeta = (f: Finding) =>
  `Серьёзность: ${SEVERITY[f.severity]}; уверенность: ${Math.round(f.confidence * 100)}%`;

// ---------------------------------------------------------------- Сверка с внешними требованиями (опция 1 ТЗ)

const COMPLIANCE_TITLE = '7. Сверка с внешними требованиями';
const COMPLIANCE_DISCLAIMER =
  'Сверка — ориентир для проверки, не юридическое заключение. Статус «Не найдено в комплекте» не означает нарушения: требование может закрываться уставом или другим документом вне комплекта. Стандарты IIA — профессиональный ориентир; национальные требования — только той страны, на законодательство которой ссылаются сами документы.';

const jurisdictionLine = (r: AnalysisResult) =>
  r.jurisdiction
    ? `Применимая юрисдикция: ${r.jurisdiction.note}${r.jurisdiction.evidence.length ? ` Основание: ${r.jurisdiction.evidence.map((e) => sourceLine(r, e)).join('; ')}.` : ''}`
    : '';

const complianceSummary = (items: ComplianceItem[]) =>
  (Object.keys(COMPLIANCE_STATUS_LABELS) as ComplianceItem['status'][])
    .map((st) => `${COMPLIANCE_STATUS_LABELS[st].toLowerCase()} — ${items.filter((x) => x.status === st).length}`)
    .join(', ');
const complianceSource = (c: ComplianceItem) => `${c.source}${c.verified === false ? ' (номер нормы не перепроверен)' : ''}`;
const complianceRefs = (r: AnalysisResult, c: ComplianceItem) => c.evidence.map((e) => sourceLine(r, e));
const mdCell = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

// ---------------------------------------------------------------- Markdown

export function reportMarkdown(r: AnalysisResult, reviews: Reviews = {}): string {
  const out: string[] = [];
  out.push('# Заключение по анализу организационной структуры и функционала', '');
  out.push(`**Документы «до»:** ${docLabel(r, 'before')}  `);
  out.push(`**Документы «после»:** ${docLabel(r, 'after')}  `);
  out.push(`**Сформировано:** ${new Date(r.meta.generatedAt).toLocaleString('ru-RU')} · модель ${r.meta.model}`, '');
  if (sameRequisites(r)) out.push(`> ${SAME_REQUISITES_NOTE}`, '');
  out.push(`**${reviewLine(r, reviews)}**`, '');
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
    if (s.findingIds.length) out.push(`_Основание: ${refsLabel(s.findingIds, reviews)}_`, '');
  }

  out.push('## 4. Рекомендации', '');
  r.conclusion.recommendations.forEach((x, i) =>
    out.push(`${i + 1}. ${x.text}${x.findingIds.length ? ` _(${refsLabel(x.findingIds, reviews)})_` : ''}`)
  );
  out.push('');

  out.push('## 5. Выводы с источниками', '');
  for (const g of grouped(r, reviews)) {
    out.push(`### ${FINDING_KIND_LABELS[g.kind]} — ${g.items.length}`, '');
    for (const f of g.items) {
      out.push(`**${f.id}. ${f.title}${reviewMark(f, reviews)}**  `, `${findingMeta(f)}  `, f.detail, '');
      for (const e of f.evidence) out.push(`- ${sourceLine(r, e)}`);
      if (f.recommendation) out.push('', `Рекомендация: ${f.recommendation}`);
      if (f.caveat) out.push('', `Требует проверки: ${f.caveat}`);
      out.push('');
    }
  }

  const rejected = rejectedOf(r, reviews);
  if (rejected.length) {
    out.push('## Приложение. Выводы, отклонённые сотрудником', '');
    for (const f of rejected) out.push(`- ${f.id}. ${f.title}`);
    out.push('');
  }

  const s = r.stats;
  out.push(
    '## 6. Сводка',
    '',
    `Пунктов: до — ${s.clausesBefore}, после — ${s.clausesAfter}. Подразделений: создано — ${s.unitsCreated}, упразднено — ${s.unitsRemoved}, реорганизовано — ${s.unitsReorganized}, без изменений — ${s.unitsRetained}. Потерянных функций: ${s.functionsLost}. Выводов: ${s.findings}.`,
    ''
  );

  const comp = r.compliance ?? [];
  if (comp.length) {
    out.push(`## ${COMPLIANCE_TITLE}`, '', `> ${COMPLIANCE_DISCLAIMER}`, '');
    if (jurisdictionLine(r)) out.push(jurisdictionLine(r), '');
    out.push(`Новая редакция, требований: ${comp.length} (${complianceSummary(comp)}).`, '');
    out.push('| Требование | Источник | Статус | Пункты новой редакции и пояснение |', '|---|---|---|---|');
    for (const c of comp) {
      const refs = complianceRefs(r, c).map(mdCell).join('<br>');
      out.push(
        `| ${mdCell(c.requirement)} | [${mdCell(complianceSource(c))}](${c.url}) | ${COMPLIANCE_STATUS_LABELS[c.status]} | ${refs ? `${refs}<br>` : ''}_${mdCell(c.note)}_ |`
      );
    }
    out.push('');
  }
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

const GRID_LINE = { style: BorderStyle.SINGLE, size: 1, color: '999999' } as const;
const GRID = { top: GRID_LINE, bottom: GRID_LINE, left: GRID_LINE, right: GRID_LINE, insideHorizontal: GRID_LINE, insideVertical: GRID_LINE };

export async function reportDocx(r: AnalysisResult, reviews: Reviews = {}): Promise<Buffer> {
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
    ...(sameRequisites(r) ? [p(SAME_REQUISITES_NOTE, { italic: true })] : []),
    p(reviewLine(r, reviews), { bold: true }),
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
    if (s.findingIds.length) children.push(p(`Основание: ${refsLabel(s.findingIds, reviews)}`, { italic: true, size: 18 }));
  }

  children.push(h('4. Рекомендации', HeadingLevel.HEADING_1));
  r.conclusion.recommendations.forEach((x, i) =>
    children.push(p(`${i + 1}. ${x.text}${x.findingIds.length ? ` (${refsLabel(x.findingIds, reviews)})` : ''}`))
  );

  children.push(h('5. Выводы с источниками', HeadingLevel.HEADING_1));
  for (const g of grouped(r, reviews)) {
    children.push(h(`${FINDING_KIND_LABELS[g.kind]} — ${g.items.length}`, HeadingLevel.HEADING_2));
    for (const f of g.items) {
      children.push(p(`${f.id}. ${f.title}${reviewMark(f, reviews)}`, { bold: true }), p(findingMeta(f), { italic: true, size: 18 }), p(f.detail));
      for (const e of f.evidence) children.push(bullet(sourceLine(r, e)));
      if (f.recommendation) children.push(p(`Рекомендация: ${f.recommendation}`));
      if (f.caveat) children.push(p(`Требует проверки: ${f.caveat}`, { italic: true }));
    }
  }

  const rejected = rejectedOf(r, reviews);
  if (rejected.length) {
    children.push(h('Приложение. Выводы, отклонённые сотрудником', HeadingLevel.HEADING_1));
    for (const f of rejected) children.push(bullet(`${f.id}. ${f.title}`));
  }

  const s = r.stats;
  children.push(
    h('6. Сводка', HeadingLevel.HEADING_1),
    p(
      `Пунктов: до — ${s.clausesBefore}, после — ${s.clausesAfter}. Подразделений: создано — ${s.unitsCreated}, упразднено — ${s.unitsRemoved}, реорганизовано — ${s.unitsReorganized}, без изменений — ${s.unitsRetained}. Потерянных функций: ${s.functionsLost}. Выводов: ${s.findings}.`
    )
  );

  const comp = r.compliance ?? [];
  if (comp.length) {
    children.push(
      h(COMPLIANCE_TITLE, HeadingLevel.HEADING_1),
      p(COMPLIANCE_DISCLAIMER, { italic: true }),
      ...(jurisdictionLine(r) ? [p(jurisdictionLine(r))] : []),
      p(`Новая редакция, требований: ${comp.length} (${complianceSummary(comp)}).`),
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: GRID,
        rows: [
          new TableRow({
            tableHeader: true,
            children: [cell('Требование', true), cell('Источник', true), cell('Статус', true), cell('Пункты новой редакции и пояснение', true)]
          }),
          ...comp.map(
            (c) =>
              new TableRow({
                children: [
                  cell(c.requirement),
                  cell(complianceSource(c)),
                  cell(COMPLIANCE_STATUS_LABELS[c.status], c.status === 'not_met' || c.status === 'contradicts'),
                  new TableCell({
                    children: [
                      ...complianceRefs(r, c).map((t) => new Paragraph({ children: [new TextRun({ text: t, size: 18 })] })),
                      new Paragraph({ children: [new TextRun({ text: c.note, italics: true, size: 18 })] })
                    ]
                  })
                ]
              })
          )
        ]
      })
    );
  }

  const doc = new Document({
    creator: 'OrgDiff',
    title: 'Заключение по анализу оргструктуры',
    styles: { default: { document: { run: { font: 'Arial', size: 22 } } } },
    sections: [{ children }]
  });
  return Packer.toBuffer(doc);
}
