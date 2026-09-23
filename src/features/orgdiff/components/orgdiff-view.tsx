'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAnalysisResult } from '../api/queries';
import { useOrgdiffParams, type OrgdiffTab } from '../hooks/use-orgdiff-params';
import type { AnalysisResult } from '../types';
import { FunctionTable } from './function-table/function-table';
import { OrgChart } from './org-chart/org-chart';
import { ResultPlaceholder } from './result-placeholder';
import { UploadPanel } from './upload-panel';

type ResultTab = Exclude<OrgdiffTab, 'upload'>;

const RESULT_TABS: { id: ResultTab; label: string }[] = [
  { id: 'chart', label: 'Схема' },
  { id: 'functions', label: 'Функции' },
  { id: 'findings', label: 'Находки' },
  { id: 'conclusion', label: 'Заключение' }
];

export function OrgdiffView() {
  const [{ tab, unit }, setParams] = useOrgdiffParams();
  const result = useAnalysisResult();

  return (
    <Tabs value={tab} onValueChange={(value) => void setParams({ tab: value as OrgdiffTab })}>
      <TabsList>
        <TabsTrigger value='upload'>Загрузка</TabsTrigger>
        {RESULT_TABS.map(({ id, label }) => (
          <TabsTrigger key={id} value={id} disabled={!result}>
            {label}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value='upload' keepMounted className='pt-2'>
        <UploadPanel onShowResults={() => void setParams({ tab: 'chart', unit: null })} />
      </TabsContent>

      {RESULT_TABS.map(({ id }) => (
        <TabsContent key={id} value={id} className='pt-2'>
          {result ? (
            <ResultTabContent
              tab={id}
              result={result}
              selectedUnitId={unit}
              onSelectUnit={(unitId) => void setParams({ unit: unitId })}
              onOpenFunctions={(unitId) => void setParams({ tab: 'functions', unit: unitId })}
            />
          ) : (
            <ResultPlaceholder
              title='Анализ ещё не запускался'
              description='Загрузите комплекты «до» и «после» (или тестовый комплект) и нажмите «Анализировать».'
              actionLabel='К загрузке документов'
              onAction={() => void setParams({ tab: 'upload' })}
            />
          )}
        </TabsContent>
      ))}
    </Tabs>
  );
}

interface ResultTabContentProps {
  tab: ResultTab;
  result: AnalysisResult;
  selectedUnitId: string | null;
  onSelectUnit: (unitId: string | null) => void;
  onOpenFunctions: (unitId: string) => void;
}

function ResultTabContent({ tab, result, ...chartProps }: ResultTabContentProps) {
  if (tab === 'chart') return <OrgChart result={result} {...chartProps} />;
  if (tab === 'functions') {
    return (
      <FunctionTable
        result={result}
        unit={chartProps.selectedUnitId}
        onUnitChange={chartProps.onSelectUnit}
      />
    );
  }
  return (
    <ResultPlaceholder title='Экран в разработке' description='Появится в следующих задачах.' />
  );
}
