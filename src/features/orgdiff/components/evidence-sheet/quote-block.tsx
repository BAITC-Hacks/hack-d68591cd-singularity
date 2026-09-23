'use client';

import { useState } from 'react';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import { useDocLabel } from '../../hooks/use-doc-label';
import type { Clause } from '../../types';
import type { QuoteRef } from '../../utils/evidence-source';
import type { DiffToken } from '../../utils/word-diff';

interface QuoteBlockProps {
  quote: QuoteRef;
  /** Подсветка отличий от парной цитаты */
  tokens?: DiffToken[];
  clause?: Clause;
}

export function QuoteBlock({ quote, tokens, clause }: QuoteBlockProps) {
  const docLabel = useDocLabel();
  const [expanded, setExpanded] = useState(false);
  const canExpand = clause !== undefined && clause.text.trim() !== quote.quote.trim();

  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 rounded-md border p-2.5',
        quote.side === 'before' ? 'bg-muted/40' : 'bg-background'
      )}
    >
      <div className='flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs'>
        <span className='font-semibold tabular-nums'>
          {docLabel(quote.side, quote.docName)} п. {quote.clauseId}
        </span>
        {quote.verified ? (
          <span className='text-primary inline-flex items-center gap-0.5'>
            <Icons.check className='size-3' aria-hidden='true' />
            цитата проверена
          </span>
        ) : null}
        {clause?.sectionTitle ? (
          <span className='text-muted-foreground truncate'>
            раздел {clause.section}. {clause.sectionTitle}
          </span>
        ) : null}
      </div>

      <p className='text-sm leading-relaxed'>
        «{tokens ? <DiffText tokens={tokens} /> : quote.quote.trim()}»
      </p>

      {canExpand ? (
        <div className='flex flex-col gap-1'>
          <button
            type='button'
            className='text-muted-foreground hover:text-foreground w-fit text-xs underline-offset-2 hover:underline'
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? 'Скрыть пункт' : 'Показать пункт целиком'}
          </button>
          {expanded ? <ClauseText text={clause.text} quote={quote.quote} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function DiffText({ tokens }: { tokens: DiffToken[] }) {
  return (
    <>
      {tokens.map((token, index) => (
        <span
          key={index}
          className={cn(
            token.kind === 'removed' &&
              'rounded-sm bg-red-500/15 text-red-800 line-through decoration-red-500/60 dark:text-red-200',
            token.kind === 'added' &&
              'rounded-sm bg-emerald-500/15 text-emerald-800 dark:text-emerald-200'
          )}
        >
          {token.text}
        </span>
      ))}
    </>
  );
}

/** Пункт целиком, цитата внутри подсвечена */
function ClauseText({ text, quote }: { text: string; quote: string }) {
  const start = text.indexOf(quote.trim());
  if (start < 0) return <p className='text-muted-foreground text-xs leading-relaxed'>{text}</p>;
  const end = start + quote.trim().length;
  return (
    <p className='text-muted-foreground text-xs leading-relaxed'>
      {text.slice(0, start)}
      <mark className='bg-primary/15 text-foreground rounded-sm'>{text.slice(start, end)}</mark>
      {text.slice(end)}
    </p>
  );
}
