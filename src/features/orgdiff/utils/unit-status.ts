import type { Icons } from '@/components/icons';
import type { UnitChange, UnitStatus } from '../types';
import { FINDING_KIND_META } from './finding-meta';

export interface UnitStatusMeta {
  label: string;
  /** Иконка и её цвет — те же, что у соответствующего вида находки */
  icon: keyof typeof Icons;
  iconClass: string;
  /** Цветная полоса слева — как у карточек-счётчиков в «Находках» */
  accentClass: string;
}

export const UNIT_STATUS_META: Record<UnitStatus, UnitStatusMeta> = {
  created: {
    label: 'Создано',
    icon: FINDING_KIND_META.unit_created.icon,
    iconClass: FINDING_KIND_META.unit_created.iconClass,
    accentClass: 'border-l-emerald-500'
  },
  retained: {
    label: 'Сохранено',
    icon: 'circleCheck',
    iconClass: 'text-muted-foreground',
    accentClass: 'border-l-muted-foreground/40'
  },
  reorganized: {
    label: 'Реорганизовано',
    icon: FINDING_KIND_META.unit_reorganized.icon,
    iconClass: FINDING_KIND_META.unit_reorganized.iconClass,
    accentClass: 'border-l-amber-500'
  },
  removed: {
    label: 'Упразднено',
    icon: FINDING_KIND_META.unit_removed.icon,
    iconClass: FINDING_KIND_META.unit_removed.iconClass,
    accentClass: 'border-l-red-500'
  }
};

export const UNIT_STATUSES: UnitStatus[] = ['created', 'reorganized', 'removed', 'retained'];

export function unitLabel(unit: Pick<UnitChange, 'abbr' | 'name'>): string {
  return unit.abbr ?? unit.name;
}
