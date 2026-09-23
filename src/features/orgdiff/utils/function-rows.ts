import type { AnalysisResult, MatchStatus, UnitFunction } from '../types';
import { MATCH_STATUS_META } from './match-status';
import { unitLabel } from './unit-status';

/** Значение фильтра «Подразделение» для функций, закреплённых за блоком в целом */
export const BLOCK_UNIT = 'block';
export const BLOCK_LABEL = 'Блок в целом';

export interface FunctionRow {
  id: string;
  status: MatchStatus;
  rank: number;
  confidence: number;
  explanation: string;
  before?: UnitFunction;
  after: UnitFunction[];
  /** UnitChange.id с обеих сторон; пусто — блок в целом */
  unitIds: string[];
  /** «ДНМ → ДИТААД, ДОА» */
  unitsLabel: string;
  /** Finding.id выводов, опирающихся на эту строку */
  findingIds: string[];
}

export interface FunctionFilters {
  statuses: MatchStatus[];
  unit: string | null;
  query: string;
}

export function buildFunctionRows(result: AnalysisResult): FunctionRow[] {
  const functions = new Map(result.functions.map((fn) => [fn.id, fn]));
  const units = new Map(result.units.map((unit) => [unit.id, unitLabel(unit)]));
  const findingsByMatch = indexFindingsByMatch(result);

  const labelOf = (fns: UnitFunction[]) => {
    const ids = [...new Set(fns.flatMap((fn) => fn.unitIds))];
    return ids.length > 0 ? ids.map((id) => units.get(id) ?? id).join(', ') : BLOCK_LABEL;
  };

  return result.matches.map((match) => {
    const before = match.beforeId ? functions.get(match.beforeId) : undefined;
    const after = match.afterIds
      .map((id) => functions.get(id))
      .filter((fn): fn is UnitFunction => fn !== undefined);
    const beforeLabel = before ? labelOf([before]) : null;
    const afterLabel = after.length > 0 ? labelOf(after) : null;

    return {
      id: match.id,
      status: match.status,
      rank: MATCH_STATUS_META[match.status].rank,
      confidence: match.confidence,
      explanation: match.explanation,
      before,
      after,
      unitIds: [...new Set([before, ...after].flatMap((fn) => fn?.unitIds ?? []))],
      unitsLabel: joinUnits(beforeLabel, afterLabel),
      findingIds: findingsByMatch.get(match.id) ?? []
    };
  });
}

export function filterFunctionRows(rows: FunctionRow[], filters: FunctionFilters): FunctionRow[] {
  const query = filters.query.trim().toLowerCase();
  return rows.filter(
    (row) =>
      filters.statuses.includes(row.status) &&
      matchesUnit(row, filters.unit) &&
      (query === '' || rowText(row).includes(query))
  );
}

export function countByStatus(rows: FunctionRow[]): Record<MatchStatus, number> {
  const counts: Record<MatchStatus, number> = {
    lost: 0,
    narrowed: 0,
    moved: 0,
    expanded: 0,
    added: 0,
    kept: 0
  };
  rows.forEach((row) => {
    counts[row.status] += 1;
  });
  return counts;
}

function matchesUnit(row: FunctionRow, unit: string | null): boolean {
  if (!unit) return true;
  if (unit === BLOCK_UNIT) return row.unitIds.length === 0;
  return row.unitIds.includes(unit);
}

function rowText(row: FunctionRow): string {
  return [
    row.unitsLabel,
    row.before?.clauseId,
    row.before?.quote,
    ...row.after.flatMap((fn) => [fn.clauseId, fn.quote])
  ]
    .join(' ')
    .toLowerCase();
}

function joinUnits(before: string | null, after: string | null): string {
  if (before && after) return before === after ? before : `${before} → ${after}`;
  return before ?? after ?? BLOCK_LABEL;
}

/** matchIds у находки могут повторяться — считаем каждую находку по строке один раз */
function indexFindingsByMatch(result: AnalysisResult): Map<string, string[]> {
  const index = new Map<string, Set<string>>();
  result.findings.forEach((finding) => {
    new Set(finding.matchIds ?? []).forEach((matchId) => {
      index.set(matchId, new Set([...(index.get(matchId) ?? []), finding.id]));
    });
  });
  return new Map([...index].map(([matchId, ids]) => [matchId, [...ids]]));
}
