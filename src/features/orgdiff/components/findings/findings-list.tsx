'use client';

import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { cn } from '@/lib/utils';
import { useFindingFilters, type ReviewFilter } from '../../hooks/use-finding-filters';
import { useFindingReviews, type FindingReviews } from '../../hooks/use-finding-reviews';
import { useOpenSource, useOrgdiffParams } from '../../hooks/use-orgdiff-params';
import type { AnalysisResult, Finding, FindingKind } from '../../types';
import { FINDING_KIND_META, FINDING_KINDS, SEVERITY_META } from '../../utils/finding-meta';
import { unitLabel } from '../../utils/unit-status';
import { FindingCard } from './finding-card';
import { StatsCards } from './stats-cards';

const REVIEW_LABELS: Record<ReviewFilter, string> = {
  all: 'Все решения',
  pending: 'Не проверены',
  confirmed: 'Подтверждены',
  rejected: 'Отклонены'
};

export function FindingsList({ result }: { result: AnalysisResult }) {
  const [{ kind, review }, setFilters] = useFindingFilters();
  const [, setParams] = useOrgdiffParams();
  const openSource = useOpenSource();
  const { reviews, setReview } = useFindingReviews(result);

  const unitNames = useMemo(
    () => new Map(result.units.map((unit) => [unit.id, unitLabel(unit)])),
    [result.units]
  );
  const sorted = useMemo(() => sortFindings(result.findings), [result.findings]);
  const byReview = sorted.filter((finding) => matchesReview(finding, reviews, review));
  const visible = byReview.filter((finding) => kind.length === 0 || kind.includes(finding.kind));
  const reviewedCount = Object.keys(reviews).length;

  const toggleKind = (value: FindingKind) =>
    void setFilters({
      kind: kind.includes(value) ? kind.filter((item) => item !== value) : [...kind, value]
    });

  return (
    <div className='flex flex-col gap-4'>
      <StatsCards
        result={result}
        activeKinds={kind}
        onSelectKinds={(kinds) => void setFilters({ kind: kinds })}
      />

      <div className='flex flex-wrap items-center gap-1.5' role='group' aria-label='Фильтр по виду'>
        {FINDING_KINDS.map((value) => {
          const count = byReview.filter((finding) => finding.kind === value).length;
          if (count === 0 && !kind.includes(value)) return null;
          const active = kind.includes(value);
          return (
            <button
              key={value}
              type='button'
              aria-pressed={active}
              onClick={() => toggleKind(value)}
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors',
                active ? 'bg-primary text-primary-foreground border-transparent' : 'hover:bg-muted'
              )}
            >
              {FINDING_KIND_META[value].label}
              <span className='tabular-nums opacity-70'>{count}</span>
            </button>
          );
        })}
      </div>

      <div className='flex flex-wrap items-center gap-2 text-sm'>
        <NativeSelect
          aria-label='Решение по выводу'
          value={review}
          onChange={(event) => void setFilters({ review: event.target.value as ReviewFilter })}
        >
          {(Object.keys(REVIEW_LABELS) as ReviewFilter[]).map((value) => (
            <NativeSelectOption key={value} value={value}>
              {REVIEW_LABELS[value]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <span className='text-muted-foreground'>
          Показано {visible.length} из {result.findings.length} · проверено {reviewedCount}
        </span>
        {kind.length > 0 || review !== 'all' ? (
          <Button
            variant='ghost'
            size='sm'
            onClick={() => void setFilters({ kind: null, review: null })}
          >
            Сбросить
          </Button>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <p className='text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm'>
          Нет выводов под выбранные фильтры
        </p>
      ) : (
        <div className='grid gap-3 xl:grid-cols-2'>
          {visible.map((finding) => (
            <FindingCard
              key={finding.id}
              finding={finding}
              unitNames={finding.unitIds.map((id) => unitNames.get(id) ?? id)}
              review={reviews[finding.id]}
              onReview={(value) => setReview(finding.id, value)}
              onOpenSource={() => openSource({ kind: 'finding', id: finding.id })}
              onShowOnChart={
                finding.unitIds.length > 0
                  ? () => void setParams({ tab: 'chart', unit: null, finding: finding.id })
                  : undefined
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Сначала важные, внутри — по порядку видов (потери и дубли выше), затем по уверенности */
function sortFindings(findings: Finding[]): Finding[] {
  return findings.toSorted(
    (a, b) =>
      SEVERITY_META[a.severity].rank - SEVERITY_META[b.severity].rank ||
      FINDING_KINDS.indexOf(a.kind) - FINDING_KINDS.indexOf(b.kind) ||
      b.confidence - a.confidence
  );
}

function matchesReview(finding: Finding, reviews: FindingReviews, filter: ReviewFilter): boolean {
  if (filter === 'all') return true;
  const value = reviews[finding.id];
  return filter === 'pending' ? value === undefined : value === filter;
}
