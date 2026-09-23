'use client';

import { Icons } from '@/components/icons';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { AnalysisResult } from '../types';

interface AnalysisDoneBannerProps {
  result: AnalysisResult;
  onShowResults: () => void;
}

export function AnalysisDoneBanner({ result, onShowResults }: AnalysisDoneBannerProps) {
  const { stats, findings, meta } = result;
  const seconds = (meta.durationMs / 1000).toFixed(1);
  const lost = findings.filter((finding) => finding.kind === 'function_lost').length;
  const overlaps = findings.filter(
    (finding) => finding.kind === 'function_duplicated' || finding.kind === 'responsibility_overlap'
  ).length;
  const conflicts = findings.filter((finding) => finding.kind === 'conflict_of_interest').length;

  return (
    <Alert>
      <Icons.circleCheck />
      <AlertTitle>
        Анализ завершён за {seconds} с{meta.fromCache ? ' (из кэша)' : ''}
      </AlertTitle>
      <AlertDescription>
        <p>
          Пунктов разобрано: {stats.clausesBefore} «до» и {stats.clausesAfter} «после».
          Подразделения: создано {stats.unitsCreated}, реорганизовано {stats.unitsReorganized},
          упразднено {stats.unitsRemoved}. Выводов с подтверждёнными источниками: {findings.length},
          из них признаки потери функций — {lost}, дублирования и пересечения — {overlaps},
          конфликта интересов — {conflicts}.
        </p>
        <Button size='sm' onClick={onShowResults}>
          К результатам
          <Icons.arrowRight />
        </Button>
      </AlertDescription>
    </Alert>
  );
}
