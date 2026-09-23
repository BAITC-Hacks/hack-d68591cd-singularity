'use client';

import { parseAsArrayOf, parseAsString, parseAsStringLiteral, useQueryStates } from 'nuqs';
import { CHANGED_STATUSES, MATCH_STATUSES } from '../utils/match-status';

/** Фильтры таблицы функций в URL; подразделение — общий параметр `unit` страницы */
export const functionFilterParsers = {
  status: parseAsArrayOf(parseAsStringLiteral(MATCH_STATUSES)).withDefault(CHANGED_STATUSES),
  q: parseAsString.withDefault('')
};

export function useFunctionFilters() {
  return useQueryStates(functionFilterParsers, { history: 'replace' });
}
