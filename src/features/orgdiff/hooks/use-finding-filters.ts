'use client';

import { parseAsArrayOf, parseAsStringLiteral, useQueryStates } from 'nuqs';
import { FINDING_KINDS } from '../utils/finding-meta';

export const REVIEW_FILTERS = ['all', 'pending', 'confirmed', 'rejected'] as const;
export type ReviewFilter = (typeof REVIEW_FILTERS)[number];

/** Фильтры экрана «Находки» в URL; пустой список видов — все виды */
export const findingFilterParsers = {
  kind: parseAsArrayOf(parseAsStringLiteral(FINDING_KINDS)).withDefault([]),
  review: parseAsStringLiteral(REVIEW_FILTERS).withDefault('all')
};

export function useFindingFilters() {
  return useQueryStates(findingFilterParsers, { history: 'replace' });
}
