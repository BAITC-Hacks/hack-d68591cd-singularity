import type { FindingReviews } from '../hooks/use-finding-reviews';
import type { AnalysisResult, DocSide } from '../types';
import { COMPLIANCE_STATUS_META, COMPLIANCE_STATUSES } from './compliance-meta';

const REVIEW_MARK = { confirmed: 'подтверждено', rejected: 'отклонено сотрудником' } as const;

/**
 * Заключение так, как оно показано на экране, — для «Скопировать».
 * В отличие от файла отчёта, учитывает решения сотрудника по выводам.
 */
export function conclusionMarkdown(result: AnalysisResult, reviews: FindingReviews): string {
  const { conclusion } = result;
  const refs = (ids: string[]) => ids.map((id) => findingRef(id, reviews)).join(', ');

  const lines = [
    '# Заключение по анализу организационной структуры и функционала',
    '',
    `**Документы «до»:** ${docTitles(result, 'before')}  `,
    `**Документы «после»:** ${docTitles(result, 'after')}  `,
    `**Сформировано:** ${formatDate(result.meta.generatedAt)}  `,
    `**Проверено сотрудником:** ${reviewSummary(result, reviews)}`,
    '',
    `> ${conclusion.disclaimer}`,
    '',
    '## Краткое резюме',
    '',
    conclusion.summary,
    '',
    ...conclusion.sections.flatMap((section) => [
      `## ${section.title}`,
      '',
      section.text,
      '',
      ...(section.findingIds.length > 0 ? [`_Основание: ${refs(section.findingIds)}_`, ''] : [])
    ]),
    ...complianceLines(result),
    '## Рекомендации',
    '',
    ...conclusion.recommendations.map(
      (item, index) =>
        `${index + 1}. ${item.text}${item.findingIds.length > 0 ? ` _(${refs(item.findingIds)})_` : ''}`
    ),
    ''
  ];
  return lines.join('\n');
}

export function reviewSummary(result: AnalysisResult, reviews: FindingReviews): string {
  const values = result.findings.map((finding) => reviews[finding.id]);
  const confirmed = values.filter((value) => value === 'confirmed').length;
  const rejected = values.filter((value) => value === 'rejected').length;
  return `${confirmed + rejected} из ${result.findings.length} выводов (подтверждено ${confirmed}, отклонено ${rejected})`;
}

export function docTitles(result: AnalysisResult, side: DocSide): string {
  return (
    result.documents
      .filter((doc) => doc.side === side)
      .map((doc) => doc.title ?? doc.name)
      .join('; ') || '—'
  );
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('ru-RU');
}

function findingRef(id: string, reviews: FindingReviews): string {
  const review = reviews[id];
  return review ? `${id} — ${REVIEW_MARK[review]}` : id;
}

/** «Выполнено — 1, частично — 10, …» по статусам, которые встречаются в сверке */
export function complianceCounts(result: AnalysisResult): string | null {
  const items = result.compliance ?? [];
  if (items.length === 0) return null;
  return COMPLIANCE_STATUSES.map((status) => ({
    label: COMPLIANCE_STATUS_META[status].label.toLowerCase(),
    count: items.filter((item) => item.status === status).length
  }))
    .filter(({ count }) => count > 0)
    .map(({ label, count }) => `${label} — ${count}`)
    .join(', ');
}

function complianceLines(result: AnalysisResult): string[] {
  const counts = complianceCounts(result);
  if (!counts) return [];
  return [
    '## Сверка с внешними требованиями',
    '',
    `Стандарты IIA и законодательство об АО, требований: ${result.compliance?.length ?? 0} (${counts}). Ориентир для проверки, не юридическое заключение.`,
    ''
  ];
}
