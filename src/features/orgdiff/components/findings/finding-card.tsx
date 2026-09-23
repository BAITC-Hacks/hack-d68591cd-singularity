'use client';

import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import type { FindingReview } from '../../hooks/use-finding-reviews';
import type { Finding } from '../../types';
import { FINDING_KIND_META, SEVERITY_META } from '../../utils/finding-meta';
import { BLOCK_LABEL } from '../../utils/function-rows';
import { EvidenceChips } from '../evidence-chip';

interface FindingCardProps {
  finding: Finding;
  unitNames: string[];
  review?: FindingReview;
  onReview: (review: FindingReview | null) => void;
  onOpenSource: () => void;
  onShowOnChart?: () => void;
}

export function FindingCard(props: FindingCardProps) {
  const { finding, unitNames, review } = props;
  const kind = FINDING_KIND_META[finding.kind];
  const severity = SEVERITY_META[finding.severity];
  const KindIcon = Icons[kind.icon];
  const confidence = Math.round(finding.confidence * 100);

  return (
    <article
      className={cn(
        'bg-card flex flex-col gap-2.5 rounded-lg border p-4 transition-opacity',
        review === 'confirmed' && 'border-l-4 border-l-emerald-500',
        review === 'rejected' && 'opacity-55'
      )}
    >
      <header className='flex flex-wrap items-center gap-x-3 gap-y-1 text-xs'>
        <span className='inline-flex items-center gap-1.5 font-medium'>
          <KindIcon className={cn('size-4', kind.iconClass)} aria-hidden='true' />
          {kind.label}
        </span>
        <span className={cn('rounded px-1.5 py-0.5 font-medium', severity.badgeClass)}>
          {severity.label} важность
        </span>
        <span className='text-muted-foreground inline-flex items-center gap-1.5'>
          уверенность {confidence}%
          <Progress value={confidence} className='w-16' aria-label={`Уверенность ${confidence}%`} />
        </span>
        <span className='text-muted-foreground ml-auto tabular-nums'>{finding.id}</span>
      </header>

      <button
        type='button'
        onClick={props.onOpenSource}
        className='text-left text-base leading-snug font-semibold underline-offset-2 hover:underline'
      >
        {finding.title}
      </button>

      <p
        className='text-muted-foreground line-clamp-3 text-sm leading-relaxed'
        title={finding.detail}
      >
        {finding.detail}
      </p>

      <div className='flex flex-wrap gap-1'>
        {(unitNames.length > 0 ? unitNames : [BLOCK_LABEL]).map((name) => (
          <span key={name} className='bg-muted rounded px-1.5 py-0.5 text-xs'>
            {name}
          </span>
        ))}
      </div>

      {finding.caveat ? (
        <p className='flex gap-1.5 text-xs text-amber-700 dark:text-amber-300'>
          <Icons.warning className='mt-px size-3.5 shrink-0' aria-hidden='true' />
          Требует проверки: {finding.caveat}
        </p>
      ) : null}
      {finding.recommendation ? (
        <p className='text-sm'>
          <span className='font-medium'>Рекомендация: </span>
          {finding.recommendation}
        </p>
      ) : null}

      <EvidenceChips evidence={finding.evidence} limit={4} onClick={props.onOpenSource} />

      <footer className='flex flex-wrap items-center gap-2 border-t pt-2.5'>
        <ReviewButtons review={review} onReview={props.onReview} />
        <div className='ml-auto flex gap-1'>
          {props.onShowOnChart ? (
            <Button variant='ghost' size='sm' onClick={props.onShowOnChart}>
              <Icons.sitemap />
              На схеме
            </Button>
          ) : null}
          <Button variant='ghost' size='sm' onClick={props.onOpenSource}>
            Источники
            <Icons.arrowRight />
          </Button>
        </div>
      </footer>
    </article>
  );
}

function ReviewButtons({
  review,
  onReview
}: {
  review?: FindingReview;
  onReview: (review: FindingReview | null) => void;
}) {
  return (
    <div className='flex gap-1' role='group' aria-label='Решение по выводу'>
      <Button
        size='sm'
        variant={review === 'confirmed' ? 'default' : 'outline'}
        aria-pressed={review === 'confirmed'}
        onClick={() => onReview(review === 'confirmed' ? null : 'confirmed')}
      >
        <Icons.check />
        {review === 'confirmed' ? 'Подтверждено' : 'Подтвердить'}
      </Button>
      <Button
        size='sm'
        variant={review === 'rejected' ? 'destructive' : 'outline'}
        aria-pressed={review === 'rejected'}
        onClick={() => onReview(review === 'rejected' ? null : 'rejected')}
      >
        <Icons.close />
        {review === 'rejected' ? 'Отклонено' : 'Отклонить'}
      </Button>
    </div>
  );
}
