import type { UnitChange, UnitStatus } from '../types';

export interface UnitStatusMeta {
  label: string;
  /** Рамка и фон узла схемы */
  nodeClass: string;
  /** Бейдж статуса */
  badgeClass: string;
  /** Цвет для легенды */
  swatchClass: string;
}

export const UNIT_STATUS_META: Record<UnitStatus, UnitStatusMeta> = {
  created: {
    label: 'Создано',
    nodeClass: 'border-emerald-500 bg-emerald-500/10',
    badgeClass: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    swatchClass: 'border-emerald-500 bg-emerald-500/20'
  },
  retained: {
    label: 'Сохранено',
    nodeClass: 'border-border bg-card',
    badgeClass: 'bg-muted text-muted-foreground',
    swatchClass: 'border-border bg-card'
  },
  reorganized: {
    label: 'Реорганизовано',
    nodeClass: 'border-amber-500 bg-amber-500/10',
    badgeClass: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    swatchClass: 'border-amber-500 bg-amber-500/20'
  },
  removed: {
    label: 'Упразднено',
    nodeClass: 'border-dashed border-red-500 bg-red-500/5',
    badgeClass: 'bg-red-500/15 text-red-700 dark:text-red-300',
    swatchClass: 'border-dashed border-red-500 bg-red-500/10'
  }
};

export function unitLabel(unit: Pick<UnitChange, 'abbr' | 'name'>): string {
  return unit.abbr ?? unit.name;
}
