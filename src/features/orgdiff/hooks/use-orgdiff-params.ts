'use client';

import { parseAsString, parseAsStringLiteral, useQueryStates } from 'nuqs';

export const ORGDIFF_TABS = ['upload', 'chart', 'functions', 'findings', 'conclusion'] as const;
export type OrgdiffTab = (typeof ORGDIFF_TABS)[number];

/** Состояние страницы в URL: вкладка и выбранное подразделение (UnitChange.id) */
export const orgdiffParsers = {
  tab: parseAsStringLiteral(ORGDIFF_TABS).withDefault('upload'),
  unit: parseAsString
};

export function useOrgdiffParams() {
  return useQueryStates(orgdiffParsers, { history: 'push' });
}
