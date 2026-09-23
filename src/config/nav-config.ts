import { NavGroup } from '@/types';

/** Навигация: сайдбар и Cmd+K. */
export const navGroups: NavGroup[] = [
  {
    label: 'Анализ',
    items: [
      {
        title: 'Оргструктура',
        url: '/dashboard/orgdiff',
        icon: 'sitemap',
        shortcut: ['o', 'o'],
        isActive: false,
        items: []
      }
    ]
  }
];
