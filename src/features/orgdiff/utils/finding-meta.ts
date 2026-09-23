import type { Icons } from '@/components/icons';
import { FINDING_KIND_LABELS, type FindingKind, type Severity } from '../types';

export interface FindingKindMeta {
  label: string;
  icon: keyof typeof Icons;
  /** Цвет иконки вида */
  iconClass: string;
}

export const FINDING_KINDS: FindingKind[] = [
  'function_lost',
  'function_duplicated',
  'responsibility_overlap',
  'conflict_of_interest',
  'unit_created',
  'unit_removed',
  'unit_reorganized',
  'function_narrowed',
  'doc_defect'
];

export const FINDING_KIND_META: Record<FindingKind, FindingKindMeta> = {
  unit_created: {
    label: FINDING_KIND_LABELS.unit_created,
    icon: 'plusCircle',
    iconClass: 'text-emerald-600'
  },
  unit_removed: {
    label: FINDING_KIND_LABELS.unit_removed,
    icon: 'unitRemoved',
    iconClass: 'text-red-600'
  },
  unit_reorganized: {
    label: FINDING_KIND_LABELS.unit_reorganized,
    icon: 'reorganize',
    iconClass: 'text-amber-600'
  },
  function_lost: {
    label: FINDING_KIND_LABELS.function_lost,
    icon: 'trendingDown',
    iconClass: 'text-red-600'
  },
  function_narrowed: {
    label: FINDING_KIND_LABELS.function_narrowed,
    icon: 'minus',
    iconClass: 'text-amber-600'
  },
  function_duplicated: {
    label: FINDING_KIND_LABELS.function_duplicated,
    icon: 'duplicate',
    iconClass: 'text-violet-600'
  },
  responsibility_overlap: {
    label: FINDING_KIND_LABELS.responsibility_overlap,
    icon: 'overlap',
    iconClass: 'text-violet-600'
  },
  conflict_of_interest: {
    label: FINDING_KIND_LABELS.conflict_of_interest,
    icon: 'conflict',
    iconClass: 'text-orange-600'
  },
  doc_defect: {
    label: FINDING_KIND_LABELS.doc_defect,
    icon: 'docDefect',
    iconClass: 'text-sky-600'
  }
};

export const SEVERITIES: Severity[] = ['high', 'medium', 'low'];

export const SEVERITY_META: Record<Severity, { label: string; rank: number; badgeClass: string }> =
  {
    high: { label: 'Высокая', rank: 0, badgeClass: 'bg-red-500/15 text-red-700 dark:text-red-300' },
    medium: {
      label: 'Средняя',
      rank: 1,
      badgeClass: 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
    },
    low: { label: 'Низкая', rank: 2, badgeClass: 'bg-muted text-muted-foreground' }
  };
