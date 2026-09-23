'use client';

import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  FINDING_KIND_LABELS,
  type AnalysisResult,
  type Severity,
  type UnitChange
} from '../../types';
import { useOpenSource } from '../../hooks/use-orgdiff-params';
import { unitLabel } from '../../utils/unit-status';
import { EvidenceChips } from '../evidence-chip';
import { UnitStatusChip } from '../unit-status-chip';

const SEVERITY_LABELS: Record<Severity, string> = {
  high: 'высокая',
  medium: 'средняя',
  low: 'низкая'
};

interface UnitDetailsProps {
  unit: UnitChange;
  result: AnalysisResult;
  onClose: () => void;
  onOpenFunctions: (unitId: string) => void;
}

export function UnitDetails({ unit, result, onClose, onOpenFunctions }: UnitDetailsProps) {
  const openSource = useOpenSource();
  const nameOf = (id: string) => {
    const found = result.units.find((item) => item.id === id);
    return found ? unitLabel(found) : id;
  };
  const transfers = result.flows.filter((flow) => flow.kind === 'transferred');
  const gaveTo = transfers.filter((flow) => flow.from === unit.id);
  const gotFrom = transfers.filter((flow) => flow.to === unit.id);
  const findings = result.findings.filter((finding) => finding.unitIds.includes(unit.id));

  return (
    <Card className='gap-4'>
      <CardHeader>
        <div className='flex items-start justify-between gap-2'>
          <div className='min-w-0'>
            <CardTitle className='flex flex-wrap items-center gap-2'>
              {unitLabel(unit)}
              <UnitStatusChip status={unit.status} />
            </CardTitle>
            {unit.abbr ? <CardDescription>{unit.name}</CardDescription> : null}
          </div>
          <Button variant='ghost' size='icon-sm' onClick={onClose} aria-label='Закрыть'>
            <Icons.close />
          </Button>
        </div>
      </CardHeader>

      <CardContent className='flex flex-col gap-4 text-sm'>
        <p>{unit.summary}</p>

        <Section title='Источник'>
          <EvidenceChips
            evidence={unit.evidence}
            limit={6}
            onClick={() => openSource({ kind: 'unit', id: unit.id })}
          />
        </Section>

        {gaveTo.length > 0 || gotFrom.length > 0 ? (
          <Section title='Движение функций'>
            <ul className='flex flex-col gap-1'>
              {gotFrom.map((flow) => (
                <li key={`in-${flow.from}`} className='flex justify-between gap-2'>
                  <span>← от {nameOf(flow.from)}</span>
                  <span className='text-muted-foreground tabular-nums'>{flow.functionCount}</span>
                </li>
              ))}
              {gaveTo.map((flow) => (
                <li key={`out-${flow.to}`} className='flex justify-between gap-2'>
                  <span>→ к {nameOf(flow.to)}</span>
                  <span className='text-muted-foreground tabular-nums'>{flow.functionCount}</span>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        <Section title='Должности'>
          <PositionsDiff before={unit.positions.before} after={unit.positions.after} />
        </Section>

        <Section title={`Выводы (${findings.length})`}>
          {findings.length === 0 ? (
            <p className='text-muted-foreground'>Выводов по подразделению нет</p>
          ) : (
            <ul className='flex flex-col gap-3'>
              {findings.map((finding) => (
                <li key={finding.id} className='flex flex-col gap-1'>
                  <p className='text-muted-foreground text-xs'>
                    {FINDING_KIND_LABELS[finding.kind]} · важность{' '}
                    {SEVERITY_LABELS[finding.severity]} · уверенность{' '}
                    {Math.round(finding.confidence * 100)}%
                  </p>
                  <button
                    type='button'
                    className='text-left leading-snug underline-offset-2 hover:underline'
                    onClick={() => openSource({ kind: 'finding', id: finding.id })}
                  >
                    {finding.title}
                  </button>
                  <EvidenceChips
                    evidence={finding.evidence}
                    limit={3}
                    onClick={() => openSource({ kind: 'finding', id: finding.id })}
                  />
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Button variant='outline' onClick={() => onOpenFunctions(unit.id)}>
          Функции подразделения «до / после»
          <Icons.arrowRight />
        </Button>
      </CardContent>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className='flex flex-col gap-1.5'>
      <h4 className='text-muted-foreground text-xs font-medium tracking-wide uppercase'>{title}</h4>
      {children}
    </section>
  );
}

function PositionsDiff({ before, after }: { before: string[]; after: string[] }) {
  if (before.length === 0 && after.length === 0) {
    return <p className='text-muted-foreground'>Не указаны</p>;
  }
  return (
    <div className='grid grid-cols-2 gap-3 text-xs'>
      <PositionList title='до' items={before} />
      <PositionList title='после' items={after} />
    </div>
  );
}

function PositionList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className='text-muted-foreground mb-1'>{title}</p>
      {items.length === 0 ? (
        <p className='text-muted-foreground'>—</p>
      ) : (
        <ul className='flex flex-col gap-0.5'>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
