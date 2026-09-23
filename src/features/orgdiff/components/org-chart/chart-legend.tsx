import { cn } from '@/lib/utils';
import type { UnitStatus } from '../../types';
import { UNIT_STATUS_META } from '../../utils/unit-status';

const STATUSES: UnitStatus[] = ['created', 'retained', 'reorganized', 'removed'];

export function ChartLegend() {
  return (
    <div className='text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs'>
      {STATUSES.map((status) => (
        <span key={status} className='inline-flex items-center gap-1.5'>
          <span
            className={cn('size-3 rounded-sm border-2', UNIT_STATUS_META[status].swatchClass)}
          />
          {UNIT_STATUS_META[status].label}
        </span>
      ))}
      <span className='inline-flex items-center gap-1.5'>
        <svg width='24' height='6' aria-hidden='true'>
          <line x1='0' y1='3' x2='24' y2='3' stroke='var(--muted-foreground)' strokeWidth='2' />
        </svg>
        функции остались
      </span>
      <span className='inline-flex items-center gap-1.5'>
        <svg width='24' height='6' aria-hidden='true'>
          <line
            x1='0'
            y1='3'
            x2='24'
            y2='3'
            stroke='var(--color-sky-500)'
            strokeWidth='2'
            strokeDasharray='6 4'
          />
        </svg>
        функции переданы (толщина — сколько)
      </span>
    </div>
  );
}
