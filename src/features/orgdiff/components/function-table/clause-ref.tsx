'use client';

import { useDocLabel } from '../../hooks/use-doc-label';
import type { UnitFunction } from '../../types';

/** Номер пункта + дословный текст функции */
export function ClauseRef({ fn }: { fn: UnitFunction }) {
  const docLabel = useDocLabel();
  return (
    <div className='flex flex-col gap-0.5'>
      <span className='text-muted-foreground text-xs tabular-nums'>
        {docLabel(fn.side)} п. {fn.clauseId}
      </span>
      <p className='line-clamp-3 text-sm leading-snug' title={fn.text}>
        {fn.quote}
      </p>
    </div>
  );
}
