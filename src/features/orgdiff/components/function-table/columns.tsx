'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { FunctionRow } from '../../utils/function-rows';
import { MATCH_STATUS_META } from '../../utils/match-status';
import { ClauseRef } from './clause-ref';

export const functionColumns: ColumnDef<FunctionRow>[] = [
  {
    id: 'unit',
    header: 'Подразделение',
    accessorFn: (row) => row.unitsLabel,
    enableSorting: false,
    cell: ({ row }) => <span className='text-sm font-medium'>{row.original.unitsLabel}</span>
  },
  {
    id: 'before',
    header: 'Функция «до»',
    enableSorting: false,
    cell: ({ row }) =>
      row.original.before ? (
        <ClauseRef fn={row.original.before} />
      ) : (
        <span className='text-muted-foreground text-sm'>— не было в «до»</span>
      )
  },
  {
    id: 'after',
    header: 'Функция «после»',
    enableSorting: false,
    cell: ({ row }) =>
      row.original.after.length > 0 ? (
        <div className='flex flex-col gap-2'>
          {row.original.status === 'lost' ? (
            <span className='text-xs text-red-700 dark:text-red-300'>
              Целиком не найдена, частичное покрытие:
            </span>
          ) : null}
          {row.original.after.map((fn) => (
            <ClauseRef key={fn.id} fn={fn} />
          ))}
        </div>
      ) : (
        <span className='text-sm text-red-700 dark:text-red-300'>— не найдена в «после»</span>
      )
  },
  {
    id: 'status',
    header: ({ column }) => <SortHeader label='Статус' column={column} />,
    accessorFn: (row) => row.rank,
    cell: ({ row }) => {
      const meta = MATCH_STATUS_META[row.original.status];
      return (
        <div className='flex flex-col gap-1'>
          <span className={cn('w-fit rounded px-1.5 py-0.5 text-xs font-medium', meta.badgeClass)}>
            {meta.label}
          </span>
          <p
            className='text-muted-foreground line-clamp-3 text-xs leading-snug'
            title={row.original.explanation}
          >
            {row.original.explanation}
          </p>
        </div>
      );
    }
  },
  {
    id: 'confidence',
    header: ({ column }) => <SortHeader label='Уверенность' column={column} />,
    accessorFn: (row) => row.confidence,
    cell: ({ row }) => (
      <span className='text-sm tabular-nums'>{Math.round(row.original.confidence * 100)}%</span>
    )
  },
  {
    id: 'findings',
    header: 'Выводы',
    enableSorting: false,
    cell: ({ row }) =>
      row.original.findingIds.length > 0 ? (
        <div className='flex flex-wrap gap-1'>
          {row.original.findingIds.map((id) => (
            <span key={id} className='bg-muted rounded px-1.5 py-0.5 text-xs tabular-nums'>
              {id}
            </span>
          ))}
        </div>
      ) : null
  }
];

interface SortHeaderProps {
  label: string;
  column: {
    getIsSorted: () => false | 'asc' | 'desc';
    toggleSorting: (desc?: boolean) => void;
  };
}

function SortHeader({ label, column }: SortHeaderProps) {
  const sorted = column.getIsSorted();
  const SortIcon =
    sorted === 'asc'
      ? Icons.chevronUp
      : sorted === 'desc'
        ? Icons.chevronDown
        : Icons.chevronsUpDown;
  return (
    <Button
      variant='ghost'
      size='sm'
      className='-ml-2'
      onClick={() => column.toggleSorting(sorted === 'asc')}
    >
      {label}
      <SortIcon />
    </Button>
  );
}
