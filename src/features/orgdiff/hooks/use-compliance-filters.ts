'use client';

import { parseAsArrayOf, parseAsStringLiteral, useQueryStates } from 'nuqs';
import { COMPLIANCE_STATUSES, JURISDICTIONS } from '../utils/compliance-meta';

/** Фильтры вкладки «Требования» в URL; пустой список — без фильтра */
export const complianceFilterParsers = {
  cstatus: parseAsArrayOf(parseAsStringLiteral(COMPLIANCE_STATUSES)).withDefault([]),
  jur: parseAsArrayOf(parseAsStringLiteral(JURISDICTIONS)).withDefault([])
};

export function useComplianceFilters() {
  return useQueryStates(complianceFilterParsers, { history: 'replace' });
}
