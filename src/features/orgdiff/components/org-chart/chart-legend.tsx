import { UNIT_STATUSES } from '../../utils/unit-status';
import { UnitStatusChip } from '../unit-status-chip';

export function ChartLegend() {
  return (
    <div className='text-muted-foreground bg-card flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border px-3 py-2 text-xs'>
      <span className='text-foreground font-medium'>Легенда:</span>
      {UNIT_STATUSES.map((status) => (
        <UnitStatusChip key={status} status={status} className='text-foreground' />
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
