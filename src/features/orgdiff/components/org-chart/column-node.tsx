'use client';

import type { NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { NODE_WIDTH, type ColumnNode as ColumnNodeType } from '../../utils/build-org-graph';

function ColumnNodeComponent({ data }: NodeProps<ColumnNodeType>) {
  return (
    <div style={{ width: NODE_WIDTH }} className='pointer-events-none select-none'>
      <p className='text-sm font-bold tracking-wide'>{data.title}</p>
      <p className='text-muted-foreground truncate text-xs'>{data.subtitle}</p>
    </div>
  );
}

export const ColumnNode = memo(ColumnNodeComponent);
