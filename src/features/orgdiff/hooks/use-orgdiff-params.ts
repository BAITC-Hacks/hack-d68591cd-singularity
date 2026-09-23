'use client';

import { parseAsString, parseAsStringLiteral, useQueryStates } from 'nuqs';
import { encodeSourceKey, type SourceKey } from '../utils/evidence-source';

export const ORGDIFF_TABS = [
  'upload',
  'chart',
  'functions',
  'findings',
  'compliance',
  'conclusion'
] as const;
export type OrgdiffTab = (typeof ORGDIFF_TABS)[number];

/**
 * Состояние страницы в URL: вкладка, выбранное подразделение (UnitChange.id)
 * открытый источник в панели справа (`finding:F4`, `match:m12`, `unit:…`, `flow:a>b`)
 * и вывод, подсвеченный на схеме
 */
export const orgdiffParsers = {
  tab: parseAsStringLiteral(ORGDIFF_TABS).withDefault('upload'),
  unit: parseAsString,
  source: parseAsString,
  /** Finding.id: подсветить на схеме затронутые подразделения */
  finding: parseAsString
};

export function useOrgdiffParams() {
  return useQueryStates(orgdiffParsers, { history: 'push' });
}

/** Открыть панель источника с любого экрана: находка, строка таблицы, узел или ребро схемы */
export function useOpenSource(): (key: SourceKey) => void {
  const [, setParams] = useOrgdiffParams();
  return (key) => void setParams({ source: encodeSourceKey(key) });
}
