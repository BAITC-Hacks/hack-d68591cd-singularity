import {
  FINDING_KIND_LABELS,
  type AnalysisResult,
  type Clause,
  type DocSide,
  type Evidence,
  type EvidencePair,
  type FindingKind,
  type FunctionMatch,
  type UnitFunction
} from '../types';
import { MATCH_STATUS_META } from './match-status';
import { UNIT_STATUS_META, unitLabel } from './unit-status';

/** Что открыто в панели источника; хранится в URL как `?source=finding:F4` */
export type SourceKey =
  | { kind: 'finding'; id: string }
  | { kind: 'match'; id: string }
  | { kind: 'unit'; id: string }
  | { kind: 'flow'; from: string; to: string };

/** Ссылка на пункт: Evidence или функция из сопоставления */
export interface QuoteRef {
  side: DocSide;
  clauseId: string;
  quote: string;
  docName?: string;
  /** undefined — цитата не проходила проверку (функции сопоставления) */
  verified?: boolean;
}

export interface SourcePair {
  before?: QuoteRef;
  after?: QuoteRef;
  note?: string;
  /** Подзаголовок группы, например статус функции в списке ребра */
  heading?: string;
}

export interface SourceView {
  title: string;
  subtitle: string;
  detail?: string;
  explanation?: string;
  caveat?: string;
  confidence?: number;
  /** true — пары сравнивают «до» и «после»; false — цитаты одной редакции (дубли, конфликты) */
  comparison: boolean;
  pairs: SourcePair[];
  findingIds: string[];
}

/** Виды находок, где источник — сравнение редакций, а не набор пунктов одной редакции */
const COMPARISON_KINDS = new Set<FindingKind>([
  'unit_created',
  'unit_removed',
  'unit_reorganized',
  'function_lost',
  'function_narrowed'
]);

export function encodeSourceKey(key: SourceKey): string {
  return key.kind === 'flow' ? `flow:${key.from}>${key.to}` : `${key.kind}:${key.id}`;
}

export function decodeSourceKey(value: string | null): SourceKey | null {
  if (!value) return null;
  const separator = value.indexOf(':');
  const kind = value.slice(0, separator);
  const rest = value.slice(separator + 1);
  if (!rest) return null;
  if (kind === 'flow') {
    const [from, to] = rest.split('>');
    return from && to ? { kind, from, to } : null;
  }
  if (kind === 'finding' || kind === 'match' || kind === 'unit') return { kind, id: rest };
  return null;
}

export function resolveSource(result: AnalysisResult, key: SourceKey): SourceView | null {
  switch (key.kind) {
    case 'finding':
      return findingSource(result, key.id);
    case 'match':
      return matchSource(result, key.id);
    case 'unit':
      return unitSource(result, key.id);
    case 'flow':
      return flowSource(result, key.from, key.to);
  }
}

/** Полный текст пункта — чтобы показать цитату в контексте */
export function findClause(result: AnalysisResult, ref: QuoteRef): Clause | undefined {
  return result.clauses.find(
    (clause) =>
      clause.side === ref.side &&
      clause.id === ref.clauseId &&
      (!ref.docName || clause.docName === ref.docName)
  );
}

function findingSource(result: AnalysisResult, id: string): SourceView | null {
  const finding = result.findings.find((item) => item.id === id);
  if (!finding) return null;
  return {
    title: finding.title,
    subtitle: `${finding.id} · ${FINDING_KIND_LABELS[finding.kind]}`,
    detail: finding.detail,
    caveat: finding.caveat,
    confidence: finding.confidence,
    comparison: COMPARISON_KINDS.has(finding.kind),
    pairs: finding.pairs?.length ? finding.pairs : evidenceToPairs(finding.evidence),
    findingIds: []
  };
}

function matchSource(result: AnalysisResult, id: string): SourceView | null {
  const match = result.matches.find((item) => item.id === id);
  if (!match) return null;
  const functions = functionIndex(result);
  const before = match.beforeId ? functions.get(match.beforeId) : undefined;
  return {
    title: before?.quote ?? functions.get(match.afterIds[0] ?? '')?.quote ?? 'Функция',
    subtitle: `Сопоставление функций · ${MATCH_STATUS_META[match.status].label}`,
    explanation: match.explanation,
    confidence: match.confidence,
    comparison: true,
    pairs: matchPairs(match, functions),
    findingIds: findingsForMatches(result, [match.id])
  };
}

function unitSource(result: AnalysisResult, id: string): SourceView | null {
  const unit = result.units.find((item) => item.id === id);
  if (!unit) return null;
  // Пары «до ↔ после» есть у находки о самом подразделении — берём их, если нашлись
  const own = result.findings.find(
    (finding) =>
      finding.unitIds.length === 1 &&
      finding.unitIds[0] === id &&
      finding.kind.startsWith('unit_') &&
      finding.pairs?.length
  );
  return {
    title: unit.name,
    subtitle: `${unitLabel(unit)} · ${UNIT_STATUS_META[unit.status].label}`,
    detail: unit.summary,
    comparison: true,
    pairs: own?.pairs ?? evidenceToPairs(unit.evidence),
    findingIds: result.findings.filter((finding) => finding.unitIds.includes(id)).map((f) => f.id)
  };
}

function flowSource(result: AnalysisResult, from: string, to: string): SourceView | null {
  const flow = result.flows.find((item) => item.from === from && item.to === to);
  if (!flow) return null;
  const nameOf = (unitId: string) => {
    const unit = result.units.find((item) => item.id === unitId);
    return unit ? unitLabel(unit) : unitId;
  };
  const functions = functionIndex(result);
  const matches = new Map(result.matches.map((match) => [match.id, match]));
  const flowMatches = [...new Set(flow.matchIds ?? [])]
    .map((matchId) => matches.get(matchId))
    .filter((match): match is FunctionMatch => match !== undefined);

  const pairs = flowMatches.flatMap((match) =>
    matchPairs(match, functions).map((pair, index) => ({
      ...pair,
      heading: index === 0 ? MATCH_STATUS_META[match.status].label : undefined
    }))
  );

  return {
    title:
      flow.kind === 'retained'
        ? `${nameOf(from)}: функции остались`
        : `${nameOf(from)} → ${nameOf(to)}: функции переданы`,
    subtitle: `Поток функций · ${flow.functionCount} шт.`,
    comparison: true,
    pairs: pairs.length > 0 ? pairs : evidenceToPairs(flow.evidence),
    findingIds: findingsForMatches(
      result,
      flowMatches.map((match) => match.id)
    )
  };
}

function matchPairs(match: FunctionMatch, functions: Map<string, UnitFunction>): SourcePair[] {
  const before = match.beforeId ? functions.get(match.beforeId) : undefined;
  const afters = match.afterIds
    .map((id) => functions.get(id))
    .filter((fn): fn is UnitFunction => fn !== undefined);
  const note = match.status === 'lost' && afters.length > 0 ? 'лишь частичное покрытие' : undefined;

  if (afters.length === 0) return [{ before: before && functionRef(before) }];
  return afters.map((after) => ({
    before: before && functionRef(before),
    after: functionRef(after),
    note
  }));
}

function functionRef(fn: UnitFunction): QuoteRef {
  return { side: fn.side, clauseId: fn.clauseId, quote: fn.quote };
}

/** Без явных пар: каждая цитата — отдельной строкой на своей стороне */
function evidenceToPairs(evidence: Evidence[]): EvidencePair[] {
  return evidence.map((item) => (item.side === 'before' ? { before: item } : { after: item }));
}

function functionIndex(result: AnalysisResult): Map<string, UnitFunction> {
  return new Map(result.functions.map((fn) => [fn.id, fn]));
}

function findingsForMatches(result: AnalysisResult, matchIds: string[]): string[] {
  const wanted = new Set(matchIds);
  return result.findings
    .filter((finding) => (finding.matchIds ?? []).some((id) => wanted.has(id)))
    .map((finding) => finding.id);
}
