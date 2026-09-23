'use client';

import { useMemo } from 'react';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import { useFindingReviews } from '../../hooks/use-finding-reviews';
import { useOpenSource } from '../../hooks/use-orgdiff-params';
import type { AnalysisResult } from '../../types';
import {
  conclusionMarkdown,
  docTitles,
  formatDate,
  reviewSummary
} from '../../utils/conclusion-markdown';
import { UNIT_STATUS_META, unitLabel } from '../../utils/unit-status';
import { ConclusionActions } from './conclusion-actions';
import { FindingRefs } from './finding-refs';

/** Итоговое заключение в виде служебной записки (must have 5 ТЗ) */
export function ConclusionView({ result }: { result: AnalysisResult }) {
  const { conclusion } = result;
  const { reviews } = useFindingReviews(result);
  const openSource = useOpenSource();
  const findings = useMemo(
    () => new Map(result.findings.map((finding) => [finding.id, finding])),
    [result.findings]
  );
  const markdown = useMemo(() => conclusionMarkdown(result, reviews), [result, reviews]);

  return (
    <article className='bg-card mx-auto flex max-w-4xl flex-col gap-6 rounded-lg border p-6 md:p-8'>
      <header className='flex flex-col gap-4 border-b pb-5'>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <div>
            <p className='text-muted-foreground text-xs tracking-wide uppercase'>
              Служебная записка
            </p>
            <h2 className='text-xl leading-tight font-semibold'>
              Заключение по анализу организационной структуры и функционала
            </h2>
          </div>
          <ConclusionActions result={result} reviews={reviews} markdown={markdown} />
        </div>
        <dl className='grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]'>
          <dt className='text-muted-foreground'>Документы «до»</dt>
          <dd>{docTitles(result, 'before')}</dd>
          <dt className='text-muted-foreground'>Документы «после»</dt>
          <dd>{docTitles(result, 'after')}</dd>
          <dt className='text-muted-foreground'>Сформировано</dt>
          <dd>{formatDate(result.meta.generatedAt)}</dd>
          <dt className='text-muted-foreground'>Проверено сотрудником</dt>
          <dd>{reviewSummary(result, reviews)}</dd>
        </dl>
        <Disclaimer text={conclusion.disclaimer} />
      </header>

      <Section title='1. Краткое резюме'>
        <p className='leading-relaxed'>{conclusion.summary}</p>
      </Section>

      <Section title='2. Изменения структуры'>
        <ul className='flex flex-col divide-y rounded-md border'>
          {result.units.map((unit) => {
            const meta = UNIT_STATUS_META[unit.status];
            return (
              <li key={unit.id}>
                <button
                  type='button'
                  onClick={() => openSource({ kind: 'unit', id: unit.id })}
                  className='hover:bg-muted/50 flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2 text-left'
                >
                  <span className='font-medium'>{unitLabel(unit)}</span>
                  <span
                    className={cn('rounded px-1.5 py-0.5 text-xs font-medium', meta.badgeClass)}
                  >
                    {meta.label}
                  </span>
                  <span className='text-muted-foreground basis-full text-sm'>{unit.summary}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </Section>

      {conclusion.sections.map((section, index) => (
        <Section key={section.title} title={`${index + 3}. ${section.title}`}>
          <p className='leading-relaxed whitespace-pre-line'>{section.text}</p>
          <FindingRefs ids={section.findingIds} findings={findings} reviews={reviews} />
        </Section>
      ))}

      <Section title={`${conclusion.sections.length + 3}. Рекомендации`}>
        <ol className='flex list-decimal flex-col gap-3 pl-5'>
          {conclusion.recommendations.map((item) => (
            <li key={item.text} className='flex flex-col gap-1 pl-1'>
              <span className='leading-relaxed'>{item.text}</span>
              <FindingRefs ids={item.findingIds} findings={findings} reviews={reviews} />
            </li>
          ))}
        </ol>
      </Section>

      <footer className='border-t pt-4'>
        <Disclaimer text={conclusion.disclaimer} />
      </footer>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className='flex flex-col gap-2.5'>
      <h3 className='text-base font-semibold'>{title}</h3>
      {children}
    </section>
  );
}

function Disclaimer({ text }: { text: string }) {
  return (
    <p className='flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-sm'>
      <Icons.info className='mt-0.5 size-4 shrink-0 text-amber-600' aria-hidden='true' />
      <span>{text}</span>
    </p>
  );
}
