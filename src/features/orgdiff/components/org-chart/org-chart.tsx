'use client';

import '@xyflow/react/dist/style.css';
import {
  Background,
  Controls,
  ReactFlow,
  type NodeMouseHandler,
  type NodeTypes
} from '@xyflow/react';
import { useTheme } from 'next-themes';
import { useMemo } from 'react';
import type { AnalysisResult } from '../../types';
import { applyFocus, buildOrgGraph, type OrgNode } from '../../utils/build-org-graph';
import { ChartLegend } from './chart-legend';
import { ColumnNode } from './column-node';
import { UnitDetails } from './unit-details';
import { UnitNode } from './unit-node';

const NODE_TYPES: NodeTypes = { unit: UnitNode, column: ColumnNode };

interface OrgChartProps {
  result: AnalysisResult;
  selectedUnitId: string | null;
  onSelectUnit: (unitId: string | null) => void;
  onOpenFunctions: (unitId: string) => void;
}

export function OrgChart({ result, selectedUnitId, onSelectUnit, onOpenFunctions }: OrgChartProps) {
  const { resolvedTheme } = useTheme();
  const graph = useMemo(() => buildOrgGraph(result), [result]);
  const focused = useMemo(() => applyFocus(graph, selectedUnitId), [graph, selectedUnitId]);
  const selectedUnit = result.units.find((unit) => unit.id === selectedUnitId);

  const handleNodeClick: NodeMouseHandler<OrgNode> = (_event, node) => {
    if (node.type !== 'unit') return;
    const unitId = node.data.unit.id;
    onSelectUnit(unitId === selectedUnitId ? null : unitId);
  };

  return (
    <div className='flex flex-col gap-3'>
      <ChartLegend />
      <div className='grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]'>
        <div className='bg-card h-[640px] overflow-hidden rounded-lg border'>
          <ReactFlow<OrgNode>
            nodes={focused.nodes}
            edges={focused.edges}
            nodeTypes={NODE_TYPES}
            onNodeClick={handleNodeClick}
            onPaneClick={() => onSelectUnit(null)}
            colorMode={resolvedTheme === 'dark' ? 'dark' : 'light'}
            nodesConnectable={false}
            zoomOnScroll={false}
            preventScrolling={false}
            edgesFocusable={false}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            minZoom={0.3}
            maxZoom={1.75}
          >
            <Background gap={24} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        {selectedUnit ? (
          <div className='lg:max-h-[640px] lg:overflow-y-auto'>
            <UnitDetails
              unit={selectedUnit}
              result={result}
              onClose={() => onSelectUnit(null)}
              onOpenFunctions={onOpenFunctions}
            />
          </div>
        ) : (
          <div className='text-muted-foreground flex items-center justify-center rounded-lg border border-dashed p-6 text-center text-sm'>
            Нажмите на подразделение, чтобы увидеть, куда ушли его функции, какие выводы его
            касаются и на каких пунктах документов они основаны.
          </div>
        )}
      </div>
    </div>
  );
}
