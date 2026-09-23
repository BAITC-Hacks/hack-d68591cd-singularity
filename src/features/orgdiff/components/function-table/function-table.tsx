'use client';

import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable
} from '@tanstack/react-table';
import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { useFunctionFilters } from '../../hooks/use-function-filters';
import type { AnalysisResult } from '../../types';
import {
  buildFunctionRows,
  countByStatus,
  filterFunctionRows,
  type FunctionRow
} from '../../utils/function-rows';
import { CHANGED_STATUSES } from '../../utils/match-status';
import { functionColumns } from './columns';
import { FunctionFilters } from './function-filters';

const PAGE_SIZE = 20;

interface FunctionTableProps {
  result: AnalysisResult;
  unit: string | null;
  onUnitChange: (unit: string | null) => void;
}

export function FunctionTable({ result, unit, onUnitChange }: FunctionTableProps) {
  const [{ status, q }, setFilters] = useFunctionFilters();

  const rows = useMemo(() => buildFunctionRows(result), [result]);
  // Счётчики статусов — с учётом подразделения и поиска, но без фильтра по статусу
  const counts = useMemo(
    () =>
      countByStatus(
        filterFunctionRows(rows, { statuses: [...CHANGED_STATUSES, 'kept'], unit, query: q })
      ),
    [rows, unit, q]
  );
  const filtered = useMemo(
    () => filterFunctionRows(rows, { statuses: status, unit, query: q }),
    [rows, status, unit, q]
  );

  const table = useReactTable<FunctionRow>({
    data: filtered,
    columns: functionColumns,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      sorting: [
        { id: 'status', desc: false },
        { id: 'confidence', desc: true }
      ],
      pagination: { pageIndex: 0, pageSize: PAGE_SIZE }
    }
  });

  const isDefault =
    unit === null &&
    q === '' &&
    status.length === CHANGED_STATUSES.length &&
    !status.includes('kept');
  const { pageIndex } = table.getState().pagination;
  const from = filtered.length === 0 ? 0 : pageIndex * PAGE_SIZE + 1;
  const to = Math.min(filtered.length, (pageIndex + 1) * PAGE_SIZE);

  return (
    <div className='flex flex-col gap-4'>
      <FunctionFilters
        statuses={status}
        counts={counts}
        unit={unit}
        units={result.units}
        query={q}
        isDefault={isDefault}
        onStatusesChange={(next) => void setFilters({ status: next })}
        onUnitChange={onUnitChange}
        onQueryChange={(next) => void setFilters({ q: next })}
        onReset={() => {
          void setFilters({ status: null, q: null });
          onUnitChange(null);
        }}
      />

      <div className='overflow-x-auto rounded-lg border'>
        <Table className='min-w-[960px] table-fixed'>
          <colgroup>
            <col className='w-[12%]' />
            <col className='w-[26%]' />
            <col className='w-[26%]' />
            <col className='w-[18%]' />
            <col className='w-[10%]' />
            <col className='w-[8%]' />
          </colgroup>
          <TableHeader className='bg-muted'>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => (
                  <TableHead key={header.id}>
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length > 0 ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} className='align-top'>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className='whitespace-normal'>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={functionColumns.length}
                  className='text-muted-foreground h-24 text-center'
                >
                  Нет функций под выбранные фильтры
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className='flex items-center justify-between gap-2 text-sm'>
        <span className='text-muted-foreground tabular-nums'>
          {from}–{to} из {filtered.length} (всего сопоставлений: {rows.length})
        </span>
        <div className='flex gap-2'>
          <Button
            variant='outline'
            size='sm'
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
          >
            Назад
          </Button>
          <Button
            variant='outline'
            size='sm'
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
          >
            Вперёд
          </Button>
        </div>
      </div>
    </div>
  );
}
