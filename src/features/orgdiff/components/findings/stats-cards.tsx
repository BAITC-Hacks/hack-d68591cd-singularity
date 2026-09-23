'use client';

import { cn } from '@/lib/utils';
import type { AnalysisResult, FindingKind } from '../../types';

interface StatCard {
  id: string;
  label: string;
  value: number;
  hint?: string;
  kinds: FindingKind[];
  accent: string;
}

interface StatsCardsProps {
  result: AnalysisResult;
  activeKinds: FindingKind[];
  onSelectKinds: (kinds: FindingKind[]) => void;
}

/** Сводка сверху: клик по карточке фильтрует список находок */
export function StatsCards({ result, activeKinds, onSelectKinds }: StatsCardsProps) {
  const cards = buildCards(result);
  const isActive = (kinds: FindingKind[]) =>
    kinds.length === activeKinds.length && kinds.every((kind) => activeKinds.includes(kind));

  return (
    <div className='grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6'>
      {cards.map((card) => {
        const active = isActive(card.kinds);
        return (
          <button
            key={card.id}
            type='button'
            aria-pressed={active}
            onClick={() => onSelectKinds(active ? [] : card.kinds)}
            className={cn(
              'bg-card hover:bg-muted/50 flex flex-col gap-1 rounded-lg border border-l-4 p-3 text-left transition-colors',
              card.accent,
              active && 'ring-primary ring-2'
            )}
          >
            <span className='text-muted-foreground text-xs'>{card.label}</span>
            <span className='text-2xl font-semibold tabular-nums'>{card.value}</span>
            <span className='text-muted-foreground min-h-4 text-xs'>{card.hint ?? ''}</span>
          </button>
        );
      })}
    </div>
  );
}

function buildCards(result: AnalysisResult): StatCard[] {
  const count = (kind: FindingKind) => result.findings.filter((f) => f.kind === kind).length;
  const narrowed = count('function_narrowed');
  const overlaps = count('responsibility_overlap');
  return [
    {
      id: 'created',
      label: 'Создано подразделений',
      value: result.stats.unitsCreated,
      kinds: ['unit_created'],
      accent: 'border-l-emerald-500'
    },
    {
      id: 'reorganized',
      label: 'Реорганизовано',
      value: result.stats.unitsReorganized,
      kinds: ['unit_reorganized'],
      accent: 'border-l-amber-500'
    },
    {
      id: 'removed',
      label: 'Упразднено',
      value: result.stats.unitsRemoved,
      kinds: ['unit_removed'],
      accent: 'border-l-red-500'
    },
    {
      id: 'lost',
      label: 'Потери функций',
      value: count('function_lost'),
      hint: narrowed > 0 ? `и ${narrowed} сужений` : undefined,
      kinds: ['function_lost', 'function_narrowed'],
      accent: 'border-l-red-500'
    },
    {
      id: 'duplicated',
      label: 'Дублирование',
      value: count('function_duplicated'),
      hint: overlaps > 0 ? `и ${overlaps} пересечений` : undefined,
      kinds: ['function_duplicated', 'responsibility_overlap'],
      accent: 'border-l-violet-500'
    },
    {
      id: 'conflicts',
      label: 'Конфликт интересов',
      value: count('conflict_of_interest'),
      kinds: ['conflict_of_interest'],
      accent: 'border-l-orange-500'
    }
  ];
}
