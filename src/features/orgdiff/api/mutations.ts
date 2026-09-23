import { mutationOptions } from '@tanstack/react-query';
import { orgdiffKeys } from './queries';
import { startAnalysis, type AnalyzePayload } from './service';

export const startAnalysisMutation = mutationOptions({
  mutationKey: [...orgdiffKeys.all, 'start'],
  mutationFn: (payload: AnalyzePayload) => startAnalysis(payload)
});
