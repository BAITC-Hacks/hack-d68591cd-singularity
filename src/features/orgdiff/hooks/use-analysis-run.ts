'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { startAnalysisMutation } from '../api/mutations';
import { analysisJobOptions, orgdiffKeys } from '../api/queries';
import type { AnalyzePayload } from '../api/service';
import type { AnalysisJob, AnalysisResult, TraceStep } from '../types';

export type RunStatus = 'idle' | 'running' | 'done' | 'error';

export interface AnalysisRun {
  status: RunStatus;
  trace: TraceStep[];
  result?: AnalysisResult;
  error?: string;
  start: (payload: AnalyzePayload) => void;
  reset: () => void;
}

/** Запуск анализа: POST → jobId → опрос GET, пока задача не завершится */
export function useAnalysisRun(): AnalysisRun {
  const queryClient = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);

  const startMutation = useMutation({
    ...startAnalysisMutation,
    onSuccess: (id) => setJobId(id)
  });
  const job = useQuery(analysisJobOptions(jobId));

  const result = job.data?.status === 'done' ? job.data.result : undefined;

  useEffect(() => {
    if (result) queryClient.setQueryData(orgdiffKeys.result(), result);
  }, [queryClient, result]);

  const error = startMutation.error?.message ?? job.error?.message ?? getJobError(job.data);

  return {
    status: getStatus({ error, result, started: startMutation.isPending || jobId !== null }),
    trace: job.data?.trace ?? [],
    result,
    error,
    start: (payload) => {
      setJobId(null);
      startMutation.mutate(payload);
    },
    reset: () => {
      setJobId(null);
      startMutation.reset();
    }
  };
}

function getStatus({
  error,
  result,
  started
}: {
  error?: string;
  result?: AnalysisResult;
  started: boolean;
}): RunStatus {
  if (error) return 'error';
  if (result) return 'done';
  return started ? 'running' : 'idle';
}

function getJobError(job?: AnalysisJob): string | undefined {
  if (job?.status === 'error') return job.error ?? 'Пайплайн завершился с ошибкой';
  if (job?.status === 'done' && !job.result) return 'Пайплайн завершился без результата';
  return undefined;
}
