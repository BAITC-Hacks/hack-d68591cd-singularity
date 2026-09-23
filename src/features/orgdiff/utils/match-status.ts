import type { MatchStatus } from '../types';

export const MATCH_STATUSES = ['lost', 'narrowed', 'moved', 'expanded', 'added', 'kept'] as const;

/** По умолчанию таблица показывает изменения; «без изменений» — по кнопке */
export const CHANGED_STATUSES: MatchStatus[] = ['lost', 'narrowed', 'moved', 'expanded', 'added'];

export interface MatchStatusMeta {
  label: string;
  /** Порядок в таблице: потери и сужения — сверху */
  rank: number;
  badgeClass: string;
}

export const MATCH_STATUS_META: Record<MatchStatus, MatchStatusMeta> = {
  lost: {
    label: 'Утрачена',
    rank: 0,
    badgeClass: 'bg-red-500/15 text-red-700 dark:text-red-300'
  },
  narrowed: {
    label: 'Сужена',
    rank: 1,
    badgeClass: 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
  },
  moved: {
    label: 'Передана',
    rank: 2,
    badgeClass: 'bg-sky-500/15 text-sky-700 dark:text-sky-300'
  },
  expanded: {
    label: 'Расширена',
    rank: 3,
    badgeClass: 'bg-violet-500/15 text-violet-700 dark:text-violet-300'
  },
  added: {
    label: 'Новая',
    rank: 4,
    badgeClass: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
  },
  kept: {
    label: 'Без изменений',
    rank: 5,
    badgeClass: 'bg-muted text-muted-foreground'
  }
};
