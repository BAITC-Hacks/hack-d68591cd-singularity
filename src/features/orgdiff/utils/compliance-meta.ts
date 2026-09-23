import { COMPLIANCE_STATUS_LABELS, type ComplianceStatus, type Jurisdiction } from '../types';

export const COMPLIANCE_STATUSES = [
  'contradicts',
  'not_met',
  'partial',
  'no_evidence',
  'met'
] as const;
export const JURISDICTIONS = ['IIA', 'KZ', 'RU'] as const;

export interface ComplianceStatusMeta {
  label: string;
  /** Порядок в списке: противоречия и невыполненное — сверху */
  rank: number;
  badgeClass: string;
  accent: string;
}

export const COMPLIANCE_STATUS_META: Record<ComplianceStatus, ComplianceStatusMeta> = {
  contradicts: {
    label: COMPLIANCE_STATUS_LABELS.contradicts,
    rank: 0,
    badgeClass: 'bg-red-600/20 text-red-800 dark:text-red-200',
    accent: 'border-l-red-600'
  },
  not_met: {
    label: COMPLIANCE_STATUS_LABELS.not_met,
    rank: 1,
    badgeClass: 'bg-red-500/15 text-red-700 dark:text-red-300',
    accent: 'border-l-red-500'
  },
  partial: {
    label: COMPLIANCE_STATUS_LABELS.partial,
    rank: 2,
    badgeClass: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    accent: 'border-l-amber-500'
  },
  no_evidence: {
    label: COMPLIANCE_STATUS_LABELS.no_evidence,
    rank: 3,
    badgeClass: 'bg-muted text-muted-foreground',
    accent: 'border-l-border'
  },
  met: {
    label: COMPLIANCE_STATUS_LABELS.met,
    rank: 4,
    badgeClass: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    accent: 'border-l-emerald-500'
  }
};

export const JURISDICTION_LABELS: Record<Jurisdiction, string> = {
  IIA: 'Стандарты IIA',
  KZ: 'Законодательство РК',
  RU: 'Законодательство РФ'
};
