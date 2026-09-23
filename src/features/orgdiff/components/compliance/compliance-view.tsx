'use client';

import { useMemo } from 'react';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useComplianceFilters } from '../../hooks/use-compliance-filters';
import { useOpenSource } from '../../hooks/use-orgdiff-params';
import type { ComplianceItem, ComplianceStatus, Jurisdiction } from '../../types';
import {
  COMPLIANCE_STATUS_META,
  COMPLIANCE_STATUSES,
  JURISDICTION_LABELS,
  JURISDICTIONS
} from '../../utils/compliance-meta';
import { ComplianceCard } from './compliance-card';

/** Сверка новой редакции с внешними требованиями (опция 1 ТЗ) */
export function ComplianceView({ items }: { items: ComplianceItem[] }) {
  const [{ cstatus, jur }, setFilters] = useComplianceFilters();
  const openSource = useOpenSource();

  const sorted = useMemo(
    () =>
      items.toSorted(
        (a, b) =>
          COMPLIANCE_STATUS_META[a.status].rank - COMPLIANCE_STATUS_META[b.status].rank ||
          JURISDICTIONS.indexOf(a.jurisdiction) - JURISDICTIONS.indexOf(b.jurisdiction)
      ),
    [items]
  );
  const byJurisdiction = sorted.filter(
    (item) => jur.length === 0 || jur.includes(item.jurisdiction)
  );
  const visible = byJurisdiction.filter(
    (item) => cstatus.length === 0 || cstatus.includes(item.status)
  );

  return (
    <div className='flex flex-col gap-4'>
      <p className='flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-sm'>
        <Icons.info className='mt-0.5 size-4 shrink-0 text-amber-600' aria-hidden='true' />
        <span>
          Сверка новой редакции с внешними требованиями — ориентир для проверки, а не юридическое
          заключение. У каждого статуса, кроме «Не найдено в комплекте», есть пункты положения с
          проверенными цитатами.
        </span>
      </p>

      <div className='grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5'>
        {COMPLIANCE_STATUSES.map((status) => (
          <StatusCard
            key={status}
            status={status}
            count={byJurisdiction.filter((item) => item.status === status).length}
            active={cstatus.includes(status)}
            onClick={() => void setFilters({ cstatus: toggle(cstatus, status) })}
          />
        ))}
      </div>

      <div
        className='flex flex-wrap items-center gap-1.5'
        role='group'
        aria-label='Фильтр по источнику требований'
      >
        {JURISDICTIONS.map((value) => (
          <JurisdictionChip
            key={value}
            value={value}
            count={items.filter((item) => item.jurisdiction === value).length}
            active={jur.includes(value)}
            onClick={() => void setFilters({ jur: toggle(jur, value) })}
          />
        ))}
        <span className='text-muted-foreground ml-2 text-sm'>
          Показано {visible.length} из {items.length}
        </span>
        {cstatus.length > 0 || jur.length > 0 ? (
          <Button
            variant='ghost'
            size='sm'
            onClick={() => void setFilters({ cstatus: null, jur: null })}
          >
            Сбросить
          </Button>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <p className='text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm'>
          Нет требований под выбранные фильтры
        </p>
      ) : (
        <div className='grid gap-3 xl:grid-cols-2'>
          {visible.map((item) => (
            <ComplianceCard
              key={item.requirementId}
              item={item}
              onOpenSource={() => openSource({ kind: 'requirement', id: item.requirementId })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface StatusCardProps {
  status: ComplianceStatus;
  count: number;
  active: boolean;
  onClick: () => void;
}

function StatusCard({ status, count, active, onClick }: StatusCardProps) {
  const meta = COMPLIANCE_STATUS_META[status];
  return (
    <button
      type='button'
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'bg-card hover:bg-muted/50 flex flex-col gap-1 rounded-lg border border-l-4 p-3 text-left transition-colors',
        meta.accent,
        active && 'ring-primary ring-2'
      )}
    >
      <span className='text-muted-foreground text-xs'>{meta.label}</span>
      <span className='text-2xl font-semibold tabular-nums'>{count}</span>
    </button>
  );
}

interface JurisdictionChipProps {
  value: Jurisdiction;
  count: number;
  active: boolean;
  onClick: () => void;
}

function JurisdictionChip({ value, count, active, onClick }: JurisdictionChipProps) {
  return (
    <button
      type='button'
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors',
        active ? 'bg-primary text-primary-foreground border-transparent' : 'hover:bg-muted'
      )}
    >
      {JURISDICTION_LABELS[value]}
      <span className='tabular-nums opacity-70'>{count}</span>
    </button>
  );
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}
