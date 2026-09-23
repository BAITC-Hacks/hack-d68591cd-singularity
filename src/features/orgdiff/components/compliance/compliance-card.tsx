'use client';

import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ComplianceItem } from '../../types';
import { COMPLIANCE_STATUS_META, JURISDICTION_LABELS } from '../../utils/compliance-meta';
import { EvidenceChips } from '../evidence-chip';

interface ComplianceCardProps {
  item: ComplianceItem;
  onOpenSource: () => void;
}

export function ComplianceCard({ item, onOpenSource }: ComplianceCardProps) {
  const status = COMPLIANCE_STATUS_META[item.status];
  const hasEvidence = item.evidence.length > 0;

  return (
    <article
      className={cn(
        'bg-card flex flex-col gap-2.5 rounded-lg border border-l-4 p-4',
        status.accent
      )}
    >
      <header className='flex flex-wrap items-center gap-x-3 gap-y-1 text-xs'>
        <span className={cn('rounded px-1.5 py-0.5 font-medium', status.badgeClass)}>
          {status.label}
        </span>
        <span className='text-muted-foreground'>{JURISDICTION_LABELS[item.jurisdiction]}</span>
        {item.verified ? (
          <span className='text-primary inline-flex items-center gap-0.5'>
            <Icons.check className='size-3' aria-hidden='true' />
            номер нормы перепроверен
          </span>
        ) : null}
      </header>

      <p className='text-base leading-snug font-semibold'>{item.requirement}</p>

      <a
        href={item.url}
        target='_blank'
        rel='noopener noreferrer'
        className='text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-xs underline-offset-2 hover:underline'
      >
        {item.source}
        <Icons.externalLink className='size-3' aria-hidden='true' />
      </a>

      <p className='text-sm leading-relaxed'>{item.note}</p>

      {item.status === 'no_evidence' ? (
        <p className='text-muted-foreground text-xs'>
          Это не нарушение: требование может закрываться уставом или другим документом вне
          комплекта.
        </p>
      ) : null}

      {hasEvidence ? (
        <footer className='flex flex-wrap items-center gap-2 border-t pt-2.5'>
          <EvidenceChips evidence={item.evidence} limit={4} onClick={onOpenSource} />
          <Button variant='ghost' size='sm' className='ml-auto' onClick={onOpenSource}>
            Пункты положения
            <Icons.arrowRight />
          </Button>
        </footer>
      ) : null}
    </article>
  );
}
