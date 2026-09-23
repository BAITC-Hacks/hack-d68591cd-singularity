'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { cn } from '@/lib/utils';
import { NODE_WIDTH, type UnitNode as UnitNodeType } from '../../utils/build-org-graph';
import { UNIT_STATUS_META, unitLabel } from '../../utils/unit-status';
import { UnitStatusChip } from '../unit-status-chip';

const VISIBLE_POSITIONS = 3;

function UnitNodeComponent({ data }: NodeProps<UnitNodeType>) {
  const { unit, side, positions, functionCount, findingCount, focus } = data;
  const meta = UNIT_STATUS_META[unit.status];
  const extraPositions = positions.length - VISIBLE_POSITIONS;

  return (
    <div
      style={{ width: NODE_WIDTH }}
      className={cn(
        'bg-card text-card-foreground rounded-lg border border-l-4 px-3 py-2 shadow-sm transition-all',
        meta.accentClass,
        focus === 'selected' && 'ring-primary ring-2 ring-offset-2',
        focus === 'dimmed' && 'opacity-35'
      )}
    >
      {side === 'after' ? <Handle type='target' position={Position.Left} /> : null}

      <UnitStatusChip status={unit.status} size='md' />
      <p className='mt-1 text-sm leading-tight font-semibold'>{unitLabel(unit)}</p>
      {unit.abbr ? (
        <p className='text-muted-foreground mt-0.5 line-clamp-2 text-xs leading-snug'>
          {unit.name}
        </p>
      ) : (
        <p className='text-muted-foreground mt-0.5 text-xs'>
          {unit.kind === 'position' ? 'Должность' : 'Подразделение'}
        </p>
      )}

      <p className='mt-1.5 text-xs'>
        Функций: <b>{functionCount}</b> · Выводов: <b>{findingCount}</b>
      </p>
      {positions.length > 0 ? (
        <p className='text-muted-foreground mt-0.5 line-clamp-2 text-[11px] leading-snug'>
          {positions.slice(0, VISIBLE_POSITIONS).join(' · ')}
          {extraPositions > 0 ? ` · +${extraPositions}` : ''}
        </p>
      ) : null}

      {side === 'before' ? <Handle type='source' position={Position.Right} /> : null}
    </div>
  );
}

export const UnitNode = memo(UnitNodeComponent);
