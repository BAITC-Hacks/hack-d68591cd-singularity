'use client';

import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { loadSampleSet } from '../api/service';
import { SAMPLE_SET_LABEL } from '../constants';
import { useAnalysisRun } from '../hooks/use-analysis-run';
import type { DocSide } from '../types';
import { AnalysisDoneBanner } from './analysis-done-banner';
import { PipelineProgress } from './pipeline-progress';
import { UploadDropzone } from './upload-dropzone';

type FileSet = Record<DocSide, File[]>;

const EMPTY_SET: FileSet = { before: [], after: [] };

interface UploadPanelProps {
  onShowResults: () => void;
}

export function UploadPanel({ onShowResults }: UploadPanelProps) {
  const [files, setFiles] = useState<FileSet>(EMPTY_SET);

  const run = useAnalysisRun();
  const sample = useMutation({
    mutationFn: loadSampleSet,
    onSuccess: (set) => {
      setFiles(set);
      run.reset();
      toast.success(`Загружен тестовый комплект: ${SAMPLE_SET_LABEL}`);
    },
    onError: (error) => toast.error(error.message)
  });

  const isRunning = run.status === 'running';

  // Блок статуса стоит над загрузкой: при запуске и завершении прокручиваем к нему,
  // иначе после нажатия «Анализировать» внизу страницы он окажется вне экрана
  const statusRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (run.status === 'idle') return;
    statusRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [run.status]);
  const isBusy = isRunning || sample.isPending;
  const missing = getMissingHint(files);

  const setSide = (side: DocSide) => (next: File[]) =>
    setFiles((prev) => ({ ...prev, [side]: next }));

  return (
    <div className='flex min-w-0 flex-col gap-4'>
      {run.status === 'idle' ? null : (
        <div ref={statusRef} className='flex min-w-0 scroll-mt-4 flex-col gap-4'>
          {run.result ? (
            <AnalysisDoneBanner result={run.result} onShowResults={onShowResults} />
          ) : null}
          <PipelineProgress
            // После завершения шаги сворачиваются — главное теперь плашка с итогом
            key={run.status === 'done' ? 'done' : 'active'}
            status={run.status}
            trace={run.trace}
            error={run.error}
            onRetry={missing === null ? () => run.start(files) : undefined}
          />
        </div>
      )}

      <div className='bg-muted/40 flex min-w-0 flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between'>
        <div className='min-w-0'>
          <p className='text-sm font-medium'>Нет своих документов под рукой?</p>
          <p className='text-muted-foreground text-sm'>
            Тестовый комплект: {SAMPLE_SET_LABEL} (реальные .docx)
          </p>
        </div>
        <div className='flex flex-wrap gap-2'>
          <Button
            variant='outline'
            className='h-auto min-h-8 max-w-full whitespace-normal text-left'
            disabled={isBusy}
            onClick={() => sample.mutate()}
          >
            {sample.isPending ? <Icons.spinner className='animate-spin' /> : <Icons.sparkles />}
            Загрузить тестовый комплект (ред. 8 → ред. 9)
          </Button>
          <Button
            variant='ghost'
            disabled={isBusy || (files.before.length === 0 && files.after.length === 0)}
            onClick={() => {
              setFiles(EMPTY_SET);
              run.reset();
            }}
          >
            Очистить
          </Button>
        </div>
      </div>

      <div className='flex min-w-0 flex-col gap-4 lg:flex-row'>
        <UploadDropzone
          side='before'
          files={files.before}
          disabled={isBusy}
          onFilesChange={setSide('before')}
        />
        <UploadDropzone
          side='after'
          files={files.after}
          disabled={isBusy}
          onFilesChange={setSide('after')}
        />
      </div>

      <div className='flex flex-col items-end gap-1'>
        <Button size='lg' disabled={isBusy || missing !== null} onClick={() => run.start(files)}>
          {isRunning ? <Icons.spinner className='animate-spin' /> : <Icons.search />}
          {isRunning ? 'Анализируем…' : 'Анализировать'}
        </Button>
        {missing ? <p className='text-muted-foreground text-xs'>{missing}</p> : null}
      </div>
    </div>
  );
}

function getMissingHint(files: FileSet): string | null {
  if (files.before.length === 0 && files.after.length === 0) {
    return 'Добавьте документы в оба комплекта или загрузите тестовый';
  }
  if (files.before.length === 0) return 'Добавьте документы в комплект ДО';
  if (files.after.length === 0) return 'Добавьте документы в комплект ПОСЛЕ';
  return null;
}
