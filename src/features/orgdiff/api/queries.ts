import { queryOptions, skipToken, useQuery } from '@tanstack/react-query';
import { JOB_POLL_MS } from '../constants';
import type { AnalysisResult } from '../types';
import { getAnalysisJob } from './service';

export const orgdiffKeys = {
  all: ['orgdiff'] as const,
  result: () => [...orgdiffKeys.all, 'result'] as const,
  job: (jobId: string | null) => [...orgdiffKeys.all, 'job', jobId] as const
};

/**
 * Результат анализа кладёт в кэш useAnalysisRun, когда задача завершилась;
 * вкладки «Схема / Функции / Находки / Заключение» только читают его.
 */
export const analysisResultOptions = () =>
  queryOptions<AnalysisResult>({
    queryKey: orgdiffKeys.result(),
    queryFn: skipToken,
    staleTime: Infinity,
    gcTime: Infinity
  });

export function useAnalysisResult(): AnalysisResult | undefined {
  return useQuery(analysisResultOptions()).data;
}

/** Опрос задачи, пока она выполняется */
export const analysisJobOptions = (jobId: string | null) =>
  queryOptions({
    queryKey: orgdiffKeys.job(jobId),
    queryFn: jobId ? () => getAnalysisJob(jobId) : skipToken,
    refetchInterval: (query) => (query.state.data?.status === 'running' ? JOB_POLL_MS : false),
    // Анализ идёт до ~3 минут: пользователь может уйти на другую вкладку — не останавливаем опрос
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
    retry: 1,
    staleTime: Infinity
  });
