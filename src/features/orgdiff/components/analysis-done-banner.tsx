'use client';

import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import type { AnalysisResult } from '../types';

interface AnalysisDoneBannerProps {
  result: AnalysisResult;
  onShowResults: () => void;
}

/** Главное событие экрана — выделено цветом и крупной кнопкой, чтобы его нельзя было пропустить */
export function AnalysisDoneBanner({ result, onShowResults }: AnalysisDoneBannerProps) {
  const { stats, findings, meta } = result;
  const seconds = (meta.durationMs / 1000).toFixed(1);
  const lost = findings.filter((finding) => finding.kind === 'function_lost').length;
  const overlaps = findings.filter(
    (finding) => finding.kind === 'function_duplicated' || finding.kind === 'responsibility_overlap'
  ).length;
  const conflicts = findings.filter((finding) => finding.kind === 'conflict_of_interest').length;

  return (
    <section
      role='status'
      aria-live='polite'
      className='flex flex-col gap-4 rounded-lg border-2 border-emerald-500/60 bg-emerald-500/10 p-4 sm:flex-row sm:items-center sm:justify-between md:p-5'
    >
      <div className='flex min-w-0 gap-3'>
        <Icons.circleCheck className='mt-0.5 size-7 shrink-0 text-emerald-600' aria-hidden='true' />
        <div className='flex min-w-0 flex-col gap-1'>
          <h3 className='text-lg leading-tight font-semibold'>
            Анализ завершён за {seconds} с{meta.fromCache ? ' (из кэша)' : ''}
          </h3>
          <p className='text-sm'>
            Выводов с подтверждёнными источниками: <b>{findings.length}</b>. Подразделения: создано{' '}
            {stats.unitsCreated}, реорганизовано {stats.unitsReorganized}, упразднено{' '}
            {stats.unitsRemoved}.
          </p>
          <p className='text-muted-foreground text-sm'>
            Признаки потери функций — {lost}, дублирования и пересечения — {overlaps}, конфликта
            интересов — {conflicts}. Пунктов разобрано: {stats.clausesBefore} «до» и{' '}
            {stats.clausesAfter} «после».
          </p>
        </div>
      </div>
      <Button size='lg' className='shrink-0' onClick={onShowResults}>
        К результатам
        <Icons.arrowRight />
      </Button>
    </section>
  );
}
