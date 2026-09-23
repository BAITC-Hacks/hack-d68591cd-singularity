import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import type { UnitStatus } from '../types';
import { UNIT_STATUS_META } from '../utils/unit-status';

interface UnitStatusChipProps {
  status: UnitStatus;
  /** md — в узле схемы: при вписывании в экран схема уменьшается, мелкий текст не читается */
  size?: 'sm' | 'md';
  className?: string;
}

/** «⊕ Создано» — иконка и цвет как у вида находки, чтобы схема и «Находки» читались одинаково */
export function UnitStatusChip({ status, size = 'sm', className }: UnitStatusChipProps) {
  const meta = UNIT_STATUS_META[status];
  const StatusIcon = Icons[meta.icon];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 font-medium',
        size === 'md' ? 'text-sm' : 'text-xs',
        className
      )}
    >
      <StatusIcon
        className={cn('shrink-0', size === 'md' ? 'size-4' : 'size-3.5', meta.iconClass)}
        aria-hidden='true'
      />
      {meta.label}
    </span>
  );
}
