'use client';

import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { cn } from '@/lib/utils';
import type { MatchStatus, UnitChange } from '../../types';
import { BLOCK_LABEL, BLOCK_UNIT } from '../../utils/function-rows';
import { MATCH_STATUS_META, MATCH_STATUSES } from '../../utils/match-status';
import { unitLabel } from '../../utils/unit-status';

interface FunctionFiltersProps {
  statuses: MatchStatus[];
  counts: Record<MatchStatus, number>;
  unit: string | null;
  units: UnitChange[];
  query: string;
  isDefault: boolean;
  onStatusesChange: (statuses: MatchStatus[]) => void;
  onUnitChange: (unit: string | null) => void;
  onQueryChange: (query: string) => void;
  onReset: () => void;
}

export function FunctionFilters(props: FunctionFiltersProps) {
  const { statuses, counts, unit, units, query, isDefault } = props;

  const toggleStatus = (status: MatchStatus) =>
    props.onStatusesChange(
      statuses.includes(status) ? statuses.filter((item) => item !== status) : [...statuses, status]
    );

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex flex-wrap gap-1.5' role='group' aria-label='Фильтр по статусу'>
        {MATCH_STATUSES.map((status) => {
          const meta = MATCH_STATUS_META[status];
          const active = statuses.includes(status);
          return (
            <button
              key={status}
              type='button'
              aria-pressed={active}
              onClick={() => toggleStatus(status)}
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors',
                active ? meta.badgeClass : 'text-muted-foreground hover:bg-muted',
                active && 'border-transparent'
              )}
            >
              {meta.label}
              <span className='tabular-nums opacity-70'>{counts[status]}</span>
            </button>
          );
        })}
      </div>

      <div className='flex flex-wrap items-center gap-2'>
        <NativeSelect
          aria-label='Подразделение'
          value={unit ?? ''}
          onChange={(event) => props.onUnitChange(event.target.value || null)}
        >
          <NativeSelectOption value=''>Все подразделения</NativeSelectOption>
          {units.map((item) => (
            <NativeSelectOption key={item.id} value={item.id}>
              {unitLabel(item)}
            </NativeSelectOption>
          ))}
          <NativeSelectOption value={BLOCK_UNIT}>{BLOCK_LABEL}</NativeSelectOption>
        </NativeSelect>
        <div className='relative w-full sm:w-72'>
          <Icons.search className='text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2' />
          <Input
            value={query}
            onChange={(event) => props.onQueryChange(event.target.value)}
            placeholder='Поиск по тексту или номеру пункта'
            aria-label='Поиск по функциям'
            className='pl-8'
          />
        </div>
        {isDefault ? null : (
          <Button variant='ghost' size='sm' onClick={props.onReset}>
            Сбросить
          </Button>
        )}
      </div>
    </div>
  );
}
