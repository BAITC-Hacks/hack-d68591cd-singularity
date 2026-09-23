'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAnalysisResult } from '../api/queries';
import { useOrgdiffParams, type OrgdiffTab } from '../hooks/use-orgdiff-params';
import type { AnalysisResult } from '../types';
import { ComplianceView } from './compliance/compliance-view';
import { ConclusionView } from './conclusion/conclusion-view';
import { EvidenceSheet } from './evidence-sheet/evidence-sheet';
import { FindingsList } from './findings/findings-list';
import { FunctionTable } from './function-table/function-table';
import { OrgChart } from './org-chart/org-chart';
import { ResultPlaceholder } from './result-placeholder';
import { TabErrorBoundary } from './tab-error-boundary';
import { UploadPanel } from './upload-panel';

type ResultTab = Exclude<OrgdiffTab, 'upload'>;

const RESULT_TAB_LABELS: Record<ResultTab, string> = {
  chart: 'Схема',
  functions: 'Функции',
  findings: 'Находки',
  compliance: 'Требования',
  conclusion: 'Заключение'
};

const RESULT_TABS = (Object.keys(RESULT_TAB_LABELS) as ResultTab[]).map((id) => ({
  id,
  label: RESULT_TAB_LABELS[id]
}));

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
              <TabErrorBoundary key={result.meta.generatedAt} label={RESULT_TAB_LABELS[id]}>
                <ResultTabContent tab={id} result={result} />
              </TabErrorBoundary>
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

  const empty = emptyTabMessage(tab, result);
  if (empty) return <ResultPlaceholder title={empty.title} description={empty.description} />;

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
  if (tab === 'compliance') return <ComplianceView items={result.compliance ?? []} />;
  return <ConclusionView result={result} />;
}

/**
 * Анализ прошёл, но данных для вкладки нет (например, загружены документы без
 * раздела о структуре) — объясняем, что это значит, вместо пустой схемы или таблицы.
 */
function emptyTabMessage(
  tab: ResultTab,
  result: AnalysisResult
): { title: string; description: string } | null {
  if (tab === 'chart' && result.units.length === 0) {
    return {
      title: 'Подразделения не найдены',
      description:
        'В документах не удалось выделить состав подразделений (обычно это раздел «Структура»). Проверьте, что загружены положения о подразделениях или оргструктура.'
    };
  }
  if (tab === 'functions' && result.matches.length === 0) {
    return {
      title: 'Функции не извлечены',
      description:
        'В документах не найдено пунктов с функциями подразделений, сопоставлять нечего. Проверьте, что загружены положения с разделом о функциях или обязанностях.'
    };
  }
  if (tab === 'compliance' && (result.compliance ?? []).length === 0) {
    return {
      title: 'Сверка с внешними требованиями не выполнялась',
      description:
        'Пайплайн не вернул результатов сверки со стандартами IIA и законодательством об АО. Остальные вкладки доступны.'
    };
  }
  const { conclusion } = result;
  if (
    tab === 'conclusion' &&
    !conclusion.summary.trim() &&
    conclusion.sections.length === 0 &&
    conclusion.recommendations.length === 0
  ) {
    return {
      title: 'Заключение не сформировано',
      description:
        'Пайплайн не вернул текст заключения. Выводы с источниками доступны на вкладке «Находки».'
    };
  }
  return null;
}
