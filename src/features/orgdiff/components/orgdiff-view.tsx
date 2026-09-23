'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAnalysisResult } from '../api/queries';
import { useOrgdiffParams, type OrgdiffTab } from '../hooks/use-orgdiff-params';
import type { AnalysisResult } from '../types';
import { ConclusionView } from './conclusion/conclusion-view';
import { EvidenceSheet } from './evidence-sheet/evidence-sheet';
import { FindingsList } from './findings/findings-list';
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
  const [{ tab, source }, setParams] = useOrgdiffParams();
  const result = useAnalysisResult();

  return (
    <>
      {result ? (
        <EvidenceSheet
          result={result}
          source={source}
          onClose={() => void setParams({ source: null })}
        />
      ) : null}
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
          <UploadPanel
            onShowResults={() => void setParams({ tab: 'findings', unit: null, finding: null })}
          />
        </TabsContent>

        {RESULT_TABS.map(({ id }) => (
          <TabsContent key={id} value={id} className='pt-2'>
            {result ? (
              <ResultTabContent tab={id} result={result} />
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
    </>
  );
}

function ResultTabContent({ tab, result }: { tab: ResultTab; result: AnalysisResult }) {
  const [{ unit, finding }, setParams] = useOrgdiffParams();
  const selectUnit = (unitId: string | null) => void setParams({ unit: unitId, finding: null });

  if (tab === 'chart') {
    return (
      <OrgChart
        result={result}
        selectedUnitId={unit}
        highlightedFindingId={finding}
        onSelectUnit={selectUnit}
        onClearHighlight={() => void setParams({ finding: null })}
        onOpenFunctions={(unitId) => void setParams({ tab: 'functions', unit: unitId })}
      />
    );
  }
  if (tab === 'functions') {
    return <FunctionTable result={result} unit={unit} onUnitChange={selectUnit} />;
  }
  if (tab === 'findings') return <FindingsList result={result} />;
  return <ConclusionView result={result} />;
}
