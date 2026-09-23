'use client';

import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import { useDocLabel } from '../hooks/use-doc-label';
import type { Evidence } from '../types';

interface EvidenceChipProps {
  evidence: Evidence;
  onClick?: (evidence: Evidence) => void;
}

/** «ред. 9 п. 3.4.в ✓» — источник вывода; цитата во всплывающей подсказке */
export function EvidenceChip({ evidence, onClick }: EvidenceChipProps) {
  const docLabel = useDocLabel();
  const label = `${docLabel(evidence.side, evidence.docName)} п. ${evidence.clauseId}`;
  const title = `${evidence.docName}, п. ${evidence.clauseId}: «${evidence.quote}»`;
  const className = cn(
    'inline-flex h-6 items-center gap-1 rounded-md border px-1.5 text-xs tabular-nums',
    evidence.side === 'before' ? 'bg-muted/50' : 'bg-background',
    onClick && 'hover:bg-muted cursor-pointer'
  );
  const content = (
    <>
      {label}
      {evidence.verified ? (
        <Icons.check className='text-primary size-3' aria-label='цитата проверена' />
      ) : null}
    </>
  );

  if (!onClick) {
    return (
      <span className={className} title={title}>
        {content}
      </span>
    );
  }
  return (
    <button type='button' className={className} title={title} onClick={() => onClick(evidence)}>
      {content}
    </button>
  );
}

interface EvidenceChipsProps {
  evidence: Evidence[];
  limit?: number;
  onClick?: (evidence: Evidence) => void;
}

export function EvidenceChips({ evidence, limit = 4, onClick }: EvidenceChipsProps) {
  const shown = evidence.slice(0, limit);
  const rest = evidence.length - shown.length;
  return (
    <div className='flex flex-wrap gap-1'>
      {shown.map((item, index) => (
        <EvidenceChip
          key={`${item.side}-${item.clauseId}-${index}`}
          evidence={item}
          onClick={onClick}
        />
      ))}
      {rest > 0 ? <span className='text-muted-foreground self-center text-xs'>+{rest}</span> : null}
    </div>
  );
}
