'use client';

import { useMemo } from 'react';
import { Icons } from '@/components/icons';
import { useDocLabel } from '../../hooks/use-doc-label';
import type { AnalysisResult } from '../../types';
import { findClause, type SourcePair } from '../../utils/evidence-source';
import { diffWords, MIN_DIFF_SIMILARITY } from '../../utils/word-diff';
import { QuoteBlock } from './quote-block';

interface PairViewProps {
  pair: SourcePair;
  result: AnalysisResult;
  /** false — цитаты одной редакции: без стрелки «до → после» и заглушек */
  comparison: boolean;
}

/** «ред. 8 п. 5.5.5 → ред. 9 п. 5.5.3»: две цитаты рядом, отличия подсвечены */
export function PairView({ pair, result, comparison }: PairViewProps) {
  const docLabel = useDocLabel();
  const { before, after } = pair;
  const diff = useMemo(
    () => (before && after ? diffWords(before.quote, after.quote) : null),
    [before, after]
  );
  const showDiff = diff !== null && !diff.identical && diff.similarity >= MIN_DIFF_SIMILARITY;

  if (!comparison) {
    return (
      <div className='flex flex-col gap-2'>
        {[before, after].map((quote) =>
          quote ? (
            <QuoteBlock
              key={`${quote.side}-${quote.clauseId}`}
              quote={quote}
              clause={findClause(result, quote)}
            />
          ) : null
        )}
        {pair.note ? <p className='text-muted-foreground text-xs'>{pair.note}</p> : null}
      </div>
    );
  }

  return (
    <div className='flex flex-col gap-2'>
      {pair.heading ? (
        <h4 className='text-muted-foreground pt-2 text-xs font-medium tracking-wide uppercase'>
          {pair.heading}
        </h4>
      ) : null}
      <div className='flex flex-wrap items-center gap-2 text-xs'>
        <span className='tabular-nums'>
          {before ? `${docLabel('before', before.docName)} п. ${before.clauseId}` : 'нет в «до»'}
        </span>
        <Icons.arrowRight className='text-muted-foreground size-3' aria-hidden='true' />
        <span className='tabular-nums'>
          {after ? `${docLabel('after', after.docName)} п. ${after.clauseId}` : 'нет в «после»'}
        </span>
        {diff?.identical ? (
          <span className='text-muted-foreground'>· текст не изменился</span>
        ) : null}
        {pair.note ? <span className='text-muted-foreground'>· {pair.note}</span> : null}
      </div>
      <div className='grid gap-2 md:grid-cols-2'>
        {before ? (
          <QuoteBlock
            quote={before}
            tokens={showDiff ? diff.before : undefined}
            clause={findClause(result, before)}
          />
        ) : (
          <MissingQuote text='В редакции «до» пункта нет' />
        )}
        {after ? (
          <QuoteBlock
            quote={after}
            tokens={showDiff ? diff.after : undefined}
            clause={findClause(result, after)}
          />
        ) : (
          <MissingQuote text='В редакции «после» соответствия не найдено' />
        )}
      </div>
    </div>
  );
}

function MissingQuote({ text }: { text: string }) {
  return (
    <div className='text-muted-foreground flex items-center justify-center rounded-md border border-dashed p-2.5 text-center text-xs'>
      {text}
    </div>
  );
}
