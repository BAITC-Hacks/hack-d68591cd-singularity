'use client';

import { useMemo, useRef } from 'react';
import { Icons } from '@/components/icons';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet';
import { useOpenSource } from '../../hooks/use-orgdiff-params';
import type { AnalysisResult } from '../../types';
import { decodeSourceKey, resolveSource } from '../../utils/evidence-source';
import { PairView } from './pair-view';

interface EvidenceSheetProps {
  result: AnalysisResult;
  source: string | null;
  onClose: () => void;
}

/** Панель источника: от любого вывода до пункта и цитаты — один клик */
export function EvidenceSheet({ result, source, onClose }: EvidenceSheetProps) {
  const openSource = useOpenSource();
  // Фокус — в начало панели, а не на последнюю кнопку: иначе она открывается прокрученной вниз
  const topRef = useRef<HTMLDivElement>(null);
  const view = useMemo(() => {
    const key = decodeSourceKey(source);
    return key ? resolveSource(result, key) : null;
  }, [result, source]);

  return (
    <Sheet open={view !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <SheetContent className='w-full gap-0 data-[side=right]:sm:max-w-3xl' initialFocus={topRef}>
        {view ? (
          <>
            <SheetHeader ref={topRef} tabIndex={-1} className='border-b pr-12 outline-none'>
              <SheetDescription>{view.subtitle}</SheetDescription>
              <SheetTitle className='leading-snug'>{view.title}</SheetTitle>
            </SheetHeader>

            <div className='flex flex-1 flex-col gap-4 overflow-y-auto p-4'>
              {view.detail || view.explanation ? (
                <p className='text-sm leading-relaxed'>{view.detail ?? view.explanation}</p>
              ) : null}
              {view.detail && view.explanation ? (
                <p className='text-muted-foreground text-sm'>{view.explanation}</p>
              ) : null}

              <div className='text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs'>
                {view.confidence !== undefined ? (
                  <span>Уверенность: {Math.round(view.confidence * 100)}%</span>
                ) : null}
                <span>Источников: {view.pairs.length}</span>
              </div>

              {view.caveat ? (
                <p className='flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-sm'>
                  <Icons.warning
                    className='mt-0.5 size-4 shrink-0 text-amber-600'
                    aria-hidden='true'
                  />
                  <span>Требует проверки: {view.caveat}</span>
                </p>
              ) : null}

              <section className='flex flex-col gap-4'>
                {view.pairs.map((pair, index) => (
                  <PairView key={index} pair={pair} result={result} comparison={view.comparison} />
                ))}
              </section>

              {view.findingIds.length > 0 ? (
                <section className='flex flex-col gap-1.5 border-t pt-3'>
                  <h4 className='text-muted-foreground text-xs font-medium tracking-wide uppercase'>
                    Связанные выводы
                  </h4>
                  <div className='flex flex-wrap gap-1.5'>
                    {view.findingIds.map((id) => (
                      <button
                        key={id}
                        type='button'
                        className='hover:bg-muted rounded-md border px-2 py-0.5 text-xs tabular-nums'
                        onClick={() => openSource({ kind: 'finding', id })}
                      >
                        {id}
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}

              <p className='text-muted-foreground mt-auto border-t pt-3 text-xs'>
                Вывод носит рекомендательный характер и требует проверки ответственным сотрудником.
              </p>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
