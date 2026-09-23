import type { Edge, Node } from '@xyflow/react';
import type { AnalysisResult, DocSide, UnitChange, UnitFlow } from '../types';

export const COLUMN_X: Record<DocSide, number> = { before: 0, after: 620 };
export const NODE_WIDTH = 300;
const HEADER_HEIGHT = 70;
const ROW_GAP = 175;

export type UnitNodeData = {
  unit: UnitChange;
  side: DocSide;
  positions: string[];
  functionCount: number;
  findingCount: number;
  /** Подразделение выбрано или связано с выбранным потоком */
  focus: 'none' | 'selected' | 'related' | 'dimmed';
};

export type ColumnNodeData = { title: string; subtitle: string };

export type UnitNode = Node<UnitNodeData, 'unit'>;
export type ColumnNode = Node<ColumnNodeData, 'column'>;
export type OrgNode = UnitNode | ColumnNode;
export type FlowEdge = Edge<{ flow: UnitFlow }>;

export interface OrgGraph {
  nodes: OrgNode[];
  edges: FlowEdge[];
}

export const nodeId = (side: DocSide, unitId: string) => `${side}:${unitId}`;

/**
 * Схема «до / после»: слева подразделения ред. «до», справа — «после»,
 * рёбра — потоки функций (UnitFlow). Порядок справа подбирается по
 * «центру тяжести» источников, чтобы рёбра меньше пересекались.
 */
export function buildOrgGraph(result: AnalysisResult): OrgGraph {
  const before = sortBefore(result.units.filter((unit) => unit.status !== 'created'));
  const beforeIndex = new Map(before.map((unit, index) => [unit.id, index]));
  const after = sortAfter(
    result.units.filter((unit) => unit.status !== 'removed'),
    result.flows,
    beforeIndex
  );

  const nodes: OrgNode[] = [
    columnNode('before', 'ДО', docNames(result, 'before')),
    columnNode('after', 'ПОСЛЕ', docNames(result, 'after')),
    ...before.map((unit, index) => unitNode(result, unit, 'before', index)),
    ...after.map((unit, index) => unitNode(result, unit, 'after', index))
  ];

  const present = new Set(nodes.map((node) => node.id));
  const edges = result.flows
    .map(flowEdge)
    .filter((edge) => present.has(edge.source) && present.has(edge.target));

  return { nodes, edges };
}

export interface GraphFocus {
  /** Выбранное подразделение: оно, его соседи по потокам, остальные приглушены */
  selectedUnitId: string | null;
  /** Подразделения из вывода («На схеме»): выделены все, активны потоки между ними */
  highlightedUnitIds: string[];
}

/**
 * Подсветка узлов и рёбер. Выбор подразделения важнее подсветки вывода.
 * Подписи «N ф.» — только у активных рёбер, иначе они наезжают друг на друга.
 */
export function applyFocus(graph: OrgGraph, focus: GraphFocus): OrgGraph {
  const { selectedUnitId, highlightedUnitIds } = focus;
  if (selectedUnitId) return focusSelected(graph, selectedUnitId);
  if (highlightedUnitIds.length > 0) return focusHighlighted(graph, new Set(highlightedUnitIds));
  return { ...graph, edges: graph.edges.map((edge) => ({ ...edge, label: undefined })) };
}

function focusSelected(graph: OrgGraph, unitId: string): OrgGraph {
  const touches = (edge: FlowEdge) =>
    edge.data?.flow.from === unitId || edge.data?.flow.to === unitId;
  const related = new Set(
    graph.edges.filter(touches).flatMap((edge) => [edge.source, edge.target])
  );
  return restyle(
    graph,
    (node) =>
      node.data.unit.id === unitId ? 'selected' : related.has(node.id) ? 'related' : 'dimmed',
    touches
  );
}

function focusHighlighted(graph: OrgGraph, unitIds: Set<string>): OrgGraph {
  return restyle(
    graph,
    (node) => (unitIds.has(node.data.unit.id) ? 'selected' : 'dimmed'),
    (edge) => unitIds.has(edge.data?.flow.from ?? '') && unitIds.has(edge.data?.flow.to ?? '')
  );
}

function restyle(
  graph: OrgGraph,
  nodeFocus: (node: UnitNode) => UnitNodeData['focus'],
  edgeActive: (edge: FlowEdge) => boolean
): OrgGraph {
  const nodes = graph.nodes.map(
    (node): OrgNode =>
      node.type === 'unit' ? { ...node, data: { ...node.data, focus: nodeFocus(node) } } : node
  );
  const edges = graph.edges.map((edge): FlowEdge => {
    const active = edgeActive(edge);
    return {
      ...edge,
      animated: active && edge.data?.flow.kind === 'transferred',
      label: active ? edge.label : undefined,
      style: { ...edge.style, opacity: active ? 1 : 0.15 }
    };
  });
  return { nodes, edges };
}

function sortBefore(units: UnitChange[]): UnitChange[] {
  // Самостоятельные должности (Главный аудитор) — наверху, как в оргструктуре
  return units.toSorted((a, b) => kindRank(a) - kindRank(b));
}

function sortAfter(
  units: UnitChange[],
  flows: UnitFlow[],
  beforeIndex: Map<string, number>
): UnitChange[] {
  const barycenter = (unit: UnitChange): number => {
    const incoming = flows.filter((flow) => flow.to === unit.id && beforeIndex.has(flow.from));
    const weight = incoming.reduce((sum, flow) => sum + flow.functionCount, 0);
    if (weight === 0) return beforeIndex.get(unit.id) ?? Number.MAX_SAFE_INTEGER;
    const total = incoming.reduce(
      (sum, flow) => sum + (beforeIndex.get(flow.from) ?? 0) * flow.functionCount,
      0
    );
    return total / weight;
  };
  return units
    .map((unit) => ({ unit, rank: kindRank(unit), center: barycenter(unit) }))
    .toSorted((a, b) => a.rank - b.rank || a.center - b.center)
    .map(({ unit }) => unit);
}

/** Главный аудитор всегда сверху; упразднённая должность — среди остальных */
function kindRank(unit: UnitChange): number {
  return unit.kind === 'position' && unit.status !== 'removed' ? 0 : 1;
}

function columnNode(side: DocSide, title: string, subtitle: string): ColumnNode {
  return {
    id: `column:${side}`,
    type: 'column',
    position: { x: COLUMN_X[side], y: 0 },
    data: { title, subtitle },
    draggable: false,
    selectable: false,
    focusable: false
  };
}

function unitNode(
  result: AnalysisResult,
  unit: UnitChange,
  side: DocSide,
  index: number
): UnitNode {
  return {
    id: nodeId(side, unit.id),
    type: 'unit',
    position: { x: COLUMN_X[side], y: HEADER_HEIGHT + index * ROW_GAP },
    data: {
      unit,
      side,
      positions: unit.positions[side],
      functionCount: result.functions.filter(
        (fn) => fn.side === side && fn.unitIds.includes(unit.id)
      ).length,
      findingCount: result.findings.filter((finding) => finding.unitIds.includes(unit.id)).length,
      focus: 'none'
    }
  };
}

function flowEdge(flow: UnitFlow): FlowEdge {
  const retained = flow.kind === 'retained';
  const color = retained ? 'var(--muted-foreground)' : 'var(--color-sky-500)';
  return {
    id: `flow:${flow.from}->${flow.to}`,
    source: nodeId('before', flow.from),
    target: nodeId('after', flow.to),
    data: { flow },
    label: `${flow.functionCount} ф.`,
    labelStyle: { fontSize: 11 },
    style: {
      stroke: color,
      strokeWidth: 1.5 + Math.min(4, flow.functionCount / 6),
      strokeDasharray: retained ? undefined : '6 4'
    }
  };
}

function docNames(result: AnalysisResult, side: DocSide): string {
  const names = result.documents
    .filter((doc) => doc.side === side)
    .map((doc) => doc.title ?? doc.name);
  return names.join(', ') || '—';
}
