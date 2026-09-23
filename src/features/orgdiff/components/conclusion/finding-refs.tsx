'use client';

import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import type { FindingReviews } from '../../hooks/use-finding-reviews';
import { useOpenSource } from '../../hooks/use-orgdiff-params';
import type { Finding } from '../../types';

interface FindingRefsProps {
  ids: string[];
  findings: Map<string, Finding>;
  reviews: FindingReviews;
}

/** «Основание: F8 F9 …» — клик открывает источник; решение сотрудника видно на ссылке */
export function FindingRefs({ ids, findings, reviews }: FindingRefsProps) {
  const openSource = useOpenSource();
  if (ids.length === 0) return null;

  return (
    <div className='flex flex-wrap items-center gap-1'>
      <span className='text-muted-foreground mr-1 text-xs'>Основание:</span>
      {ids.map((id) => {
        const finding = findings.get(id);
        const review = reviews[id];
        return (
          <button
            key={id}
            type='button'
            title={finding ? `${finding.title}${review === 'rejected' ? ' (отклонено)' : ''}` : id}
            onClick={() => openSource({ kind: 'finding', id })}
            className={cn(
              'hover:bg-muted inline-flex h-6 items-center gap-1 rounded-md border px-1.5 text-xs tabular-nums',
              review === 'confirmed' && 'border-emerald-500/60',
              review === 'rejected' && 'text-muted-foreground line-through'
            )}
          >
            {id}
            {review === 'confirmed' ? (
              <Icons.check className='size-3 text-emerald-600' aria-label='подтверждено' />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
