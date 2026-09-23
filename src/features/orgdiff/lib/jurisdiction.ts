import type { Evidence, Jurisdiction, JurisdictionInfo } from '../types';
import type { ParsedClause } from './parse-clauses';

/**
 * Применимое законодательство — по прямым ссылкам в самих документах, а не по месту проведения.
 * Стандарты IIA применимы всегда (профессиональный ориентир). Несколько стран сразу — только если
 * документ ссылается на обе примерно одинаково часто.
 */
const SIGNALS: Record<'KZ' | 'RU', RegExp> = {
  RU: /Российской\s+Федерации|(?<!\p{L})РФ(?!\p{L})|Федеральн\p{L}*\s+закон|(?<!\p{L})ФЗ(?!\p{L})|(?<!\p{L})ПАО(?!\p{L})|Банк\p{L}*\s+России|рубл\p{L}*/giu,
  KZ: /Республик\p{L}*\s+Казахстан|(?<!\p{L})РК(?!\p{L})|(?<!\p{L})АРРФР(?!\p{L})|Самрук|тенге|(?<!\p{L})ТОО(?!\p{L})/giu
};

const LABEL: Record<'KZ' | 'RU', string> = { KZ: 'Республики Казахстан', RU: 'Российской Федерации' };

/** Дословный фрагмент пункта вокруг совпадения — годится как проверяемая цитата. */
function around(text: string, index: number, length: number): string {
  const start = Math.max(0, text.lastIndexOf(' ', Math.max(0, index - 60)) + 1);
  const endAt = text.indexOf(' ', Math.min(text.length, index + length + 60));
  return text.slice(start, endAt === -1 ? text.length : endAt).trim();
}

export function detectJurisdiction(clauses: ParsedClause[]): JurisdictionInfo {
  const hits: Record<'KZ' | 'RU', number> = { KZ: 0, RU: 0 };
  const evidence: Record<'KZ' | 'RU', Evidence[]> = { KZ: [], RU: [] };
  // Сначала новая редакция: её и сверяем с требованиями.
  const ordered = [...clauses.filter((c) => c.side === 'after'), ...clauses.filter((c) => c.side === 'before')];
  for (const c of ordered) {
    for (const j of ['KZ', 'RU'] as const) {
      for (const m of c.text.matchAll(SIGNALS[j])) {
        hits[j]++;
        if (evidence[j].length < 2 && !evidence[j].some((e) => e.side === c.side && e.clauseId === c.id)) {
          evidence[j].push({ side: c.side, docName: c.docName, clauseId: c.id, quote: around(c.text, m.index ?? 0, m[0].length), verified: true });
        }
      }
    }
  }

  const found = (['KZ', 'RU'] as const).filter((j) => hits[j] > 0);
  if (!found.length) {
    return {
      applicable: ['IIA', 'KZ'],
      basis: 'default',
      note: 'В документах нет ссылок на законодательство конкретной страны — применены требования Республики Казахстан (контекст использования) и стандарты IIA.',
      evidence: []
    };
  }
  const [top, other] = found.toSorted((a, b) => hits[b] - hits[a]);
  const both = other && hits[top] < 2 * hits[other];
  const chosen: ('KZ' | 'RU')[] = both ? [top, other] : [top];
  return {
    applicable: ['IIA', ...chosen] as Jurisdiction[],
    basis: 'documents',
    note: both
      ? `Документы ссылаются на законодательство обеих стран (${LABEL.RU}: ${hits.RU}, ${LABEL.KZ}: ${hits.KZ}) — применены требования обеих и стандарты IIA.`
      : `Документы ссылаются на законодательство ${LABEL[top]} (${hits[top]} упоминаний${other ? `; ${LABEL[other]} — ${hits[other]}` : ''}) — применены его требования и стандарты IIA.`,
    evidence: chosen.flatMap((j) => evidence[j])
  };
}
