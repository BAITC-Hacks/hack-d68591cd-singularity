'use client';

import { useState } from 'react';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import type { RunStatus } from '../hooks/use-analysis-run';
import type { TraceStep } from '../types';

interface PipelineProgressProps {
  status: RunStatus;
  trace: TraceStep[];
  error?: string;
  /** Повторить с теми же файлами — показывается при ошибке */
  onRetry?: () => void;
}

const STATUS_TEXT: Record<RunStatus, string> = {
  idle: '',
  running: 'Агент работает — шаги появляются по мере выполнения',
  done: 'Анализ завершён',
  error: 'Анализ остановлен'
};

export function PipelineProgress({ status, trace, error, onRetry }: PipelineProgressProps) {
  const percent = getPercent(status, trace);
  // После успешного завершения шаги свёрнуты: итог уже в плашке выше
  const [expanded, setExpanded] = useState(status !== 'done');

  return (
    <Card className={cn(!expanded && 'gap-0 py-3')}>
      <CardHeader className={cn(!expanded && 'py-0')}>
        <div className='flex items-center justify-between gap-3'>
          <div className='flex flex-col gap-1'>
            <CardTitle>Ход анализа</CardTitle>
            <CardDescription>
              {STATUS_TEXT[status]}
              {status === 'done' ? ` · шагов агента: ${trace.length}` : ''}
            </CardDescription>
          </div>
          {status === 'done' ? (
            <Button
              variant='ghost'
              size='sm'
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? 'Свернуть шаги' : 'Показать шаги'}
              {expanded ? <Icons.chevronUp /> : <Icons.chevronDown />}
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className={cn('flex flex-col gap-4', !expanded && 'hidden')}>
        <Progress value={percent} aria-label='Прогресс анализа' />
        <ol className='flex flex-col gap-1.5'>
          {trace.map((step, index) => (
            <TraceStepItem key={step.id} index={index} step={step} />
          ))}
          {status === 'running' && trace.length === 0 ? (
            <li className='text-muted-foreground flex items-center gap-2 text-sm'>
              <Icons.spinner className='size-4 animate-spin' aria-hidden='true' />
              Отправляем документы…
            </li>
          ) : null}
        </ol>
        {error ? (
          <div
            role='alert'
            className='border-destructive/40 bg-destructive/5 flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between'
          >
            <ErrorText error={error} />
            {onRetry ? (
              <Button variant='outline' size='sm' className='shrink-0' onClick={onRetry}>
                <Icons.search />
                Повторить анализ
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function TraceStepItem({ index, step }: { index: number; step: TraceStep }) {
  const seconds =
    step.finishedAt !== undefined ? ((step.finishedAt - step.startedAt) / 1000).toFixed(1) : null;

  return (
    <li
      aria-current={step.status === 'running' ? 'step' : undefined}
      className={cn(
        'flex items-start gap-3 rounded-md px-2 py-1.5',
        step.status === 'running' && 'bg-primary/5',
        step.status === 'pending' && 'opacity-50',
        step.status === 'error' && 'bg-destructive/5'
      )}
    >
      <StepIcon status={step.status} />
      <div className='min-w-0 flex-1'>
        <p className='text-sm font-medium'>
          {index + 1}. {step.label}
        </p>
        {step.detail ? <p className='text-muted-foreground text-xs'>{step.detail}</p> : null}
      </div>
      {seconds ? (
        <span className='text-muted-foreground shrink-0 text-xs tabular-nums'>{seconds} с</span>
      ) : null}
    </li>
  );
}

function StepIcon({ status }: { status: TraceStep['status'] }) {
  const className = 'mt-0.5 size-4 shrink-0';
  if (status === 'done') {
    return <Icons.circleCheck className={cn(className, 'text-primary')} aria-label='готово' />;
  }
  if (status === 'running') {
    return <Icons.spinner className={cn(className, 'animate-spin')} aria-label='выполняется' />;
  }
  if (status === 'error') {
    return <Icons.circleX className={cn(className, 'text-destructive')} aria-label='ошибка' />;
  }
  if (status === 'pending') {
    return <Icons.circle className={cn(className, 'text-muted-foreground')} aria-label='ожидает' />;
  }
  return <Icons.minus className={cn(className, 'text-muted-foreground')} aria-label='пропущен' />;
}

/** План шагов приходит сразу (pending), поэтому процент — доля завершённых из всего trace */
function getPercent(status: RunStatus, trace: TraceStep[]): number {
  if (status === 'done') return 100;
  if (trace.length === 0) return 0;
  const finished = trace.filter(
    (step) => step.status === 'done' || step.status === 'skipped'
  ).length;
  return Math.min(95, Math.round((finished / trace.length) * 100));
}

const GENERIC_PIPELINE_ERROR =
  'Не удалось прочитать документы. Проверьте, что файлы не повреждены и сохранены в формате .docx, .pdf, .xlsx или это скан .png / .jpg.';

/**
 * Сообщения пайплайна по-русски показываем как есть; сырые технические
 * (например, от парсера docx на английском) — заменяем понятным текстом,
 * а исходное оставляем мелко для разбора.
 */
function ErrorText({ error }: { error: string }) {
  if (/[а-яё]/i.test(error)) return <p className='text-destructive text-sm'>{error}</p>;
  return (
    <div className='flex flex-col gap-1'>
      <p className='text-destructive text-sm'>{GENERIC_PIPELINE_ERROR}</p>
      <p className='text-muted-foreground text-xs break-all'>Техническая причина: {error}</p>
    </div>
  );
}
