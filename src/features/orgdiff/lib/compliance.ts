import requirementsData from '../../../../data/requirements.json';
import type { ComplianceItem, ComplianceStatus, Evidence, Jurisdiction } from '../types';
import { llmJson, S } from './llm';
import type { ParsedClause } from './parse-clauses';
import { clip, quoteInText } from './text';

/**
 * Опция 1 ТЗ: сверка новой редакции с внешними требованиями к функции внутреннего аудита
 * (стандарты IIA, Закон РК «Об АО», 208-ФЗ). Один вызов модели по всем требованиям;
 * каждая цитата проверяется по тексту пункта, статус без подтверждённой цитаты понижается до no_evidence.
 * Результат — ориентир для проверки сотрудником, а не юридическое заключение.
 */

export interface Requirement {
  id: string;
  jurisdiction: Jurisdiction;
  text: string;
  source_ref: string;
  url: string;
  verified: boolean;
}

export const REQUIREMENTS = requirementsData as Requirement[];

/** Разделы, где положения о ВА обычно регулируют статус, подчинённость, качество и отчётность (по заголовкам, не по номерам). */
const RELEVANT_SECTION =
  /общ(ие|ее)\s+положени|цел|задач|функци|структур|организац\w*\s+работ|прав|обязанност|взаимоотношени|связи|независим|дзо|дочерн|планировани|качеств|оценк|информирован|отч[её]т|подотч[её]т|рекомендаци|мониторинг/iu;
/** Разделы с процедурой отдельных проверок и заключительные положения: для сверки статуса функции почти не нужны. */
const SKIP_SECTION = /организаци\w*\s+проверк|проведени\w*\s+проверк|заключительн/iu;
/** Пункты вне релевантных разделов, которые всё равно берём: независимость, доступ, контроль исполнения рекомендаций. */
const RELEVANT_TEXT =
  /независим|конфликт\w*\s+интерес|объективн|неограниченн\w*\s+доступ|внешн\w*\s+оценк|выполнени\w*\s+рекомендаци|исполнени\w*\s+рекомендаци|мониторинг\w*\s+(?:выполнени|исполнени)/iu;

const MAX_CLAUSES = 260;
const CLAUSE_CHARS = 450;

const STATUSES: ComplianceStatus[] = ['met', 'partial', 'not_met', 'contradicts', 'no_evidence'];

const SCHEMA = S.obj({
  items: S.arr(
    S.obj({
      requirementId: S.str('id требования из списка'),
      status: S.enum(...STATUSES),
      evidence: S.arr(
        S.obj({
          ref: S.str('ссылка пункта из списка, например K12'),
          quote: S.str('дословная цитата из этого пункта')
        })
      ),
      note: S.str('1–2 предложения: почему такой статус')
    })
  )
});

interface Verdict {
  requirementId: string;
  status: ComplianceStatus;
  evidence: { ref: string; quote: string }[];
  note: string;
}

/** Пункты новой редакции для сверки: релевантные разделы по заголовкам плюс пункты с ключевыми словами. */
export function complianceClauses(clauses: ParsedClause[]): ParsedClause[] {
  const withText = clauses.filter((c) => !c.cells && c.text.trim().length >= 15);
  const picked = withText.filter(
    (c) =>
      (RELEVANT_SECTION.test(c.sectionTitle) && !SKIP_SECTION.test(c.sectionTitle)) ||
      RELEVANT_TEXT.test(c.text)
  );
  // Заголовки не распознались (нестандартный документ) — берём весь текст «после».
  return (picked.length >= 10 ? picked : withText).slice(0, MAX_CLAUSES);
}

/** Служебные ссылки модели «K12» в пояснении → номера пунктов документа. */
const humanRefs = (note: string, refs: Map<string, ParsedClause>) =>
  note.replace(/(?:пункт\p{L}*\s+)?\b(K\d+)\b/gu, (m, ref: string) =>
    refs.has(ref) ? `п. ${refs.get(ref)!.id}` : m
  );

export async function checkCompliance(after: ParsedClause[], applicable: Jurisdiction[]): Promise<ComplianceItem[]> {
  const clauses = complianceClauses(after);
  if (!clauses.length) return [];
  const requirements = REQUIREMENTS.filter((r) => applicable.includes(r.jurisdiction));
  const refs = new Map(clauses.map((c, i) => [`K${i + 1}`, c]));
  const listing = [...refs.entries()]
    .map(
      ([ref, c]) =>
        `[${ref}] ${c.docName}, разд. «${c.sectionTitle}», п. ${c.id}: «${clip(c.text, CLAUSE_CHARS)}»`
    )
    .join('\n');
  const reqs = requirements.map(
    (r) => `- ${r.id} [${r.jurisdiction}; ${r.source_ref}]: ${r.text}`
  ).join('\n');

  const prompt = `Сверь НОВУЮ редакцию документов о внутреннем аудите с внешними требованиями (стандарты IIA и законы об акционерных обществах). Оцени КАЖДОЕ требование из списка ровно один раз.

Статусы:
- met — документ прямо закрепляет требование;
- partial — закрепляет не полностью (нет части условий, другой уровень утверждения, размытая формулировка);
- not_met — документ регулирует этот вопрос, но иначе, чем требует норма (например, решение принимает не тот орган);
- contradicts — положение документа прямо противоречит требованию;
- no_evidence — в переданных пунктах нет положений по теме. Это НЕ нарушение: требование может закрываться уставом или другим документом вне комплекта.

Правила: для met, partial, not_met и contradicts обязательно дай ссылки на пункты и ДОСЛОВНЫЕ цитаты из них (короткий фрагмент, 5–25 слов). Не додумывай: если текст не позволяет судить — no_evidence. Применимое законодательство уже определено по ссылкам в самих документах — в списке только применимые требования; IIA — профессиональный ориентир. В note — 1–2 предложения по существу, без категоричных юридических выводов («признаки несоответствия», «требует проверки»).

Требования:
${reqs}

Пункты новой редакции:
${listing}`;

  const r = await llmJson<{ items: Verdict[] }>('check_compliance', SCHEMA, prompt, {
    effort: 'low'
  });
  const byId = new Map(r.items.map((v) => [v.requirementId, v]));

  return requirements.map((req): ComplianceItem => {
    const v = byId.get(req.id);
    const base = {
      requirementId: req.id,
      jurisdiction: req.jurisdiction,
      source: req.source_ref,
      requirement: req.text,
      url: req.url,
      verified: req.verified
    };
    if (!v) {
      return {
        ...base,
        status: 'no_evidence',
        evidence: [],
        note: 'Модель не дала оценку по требованию — требует ручной проверки.'
      };
    }
    const seen = new Set<string>();
    const evidence: Evidence[] = [];
    for (const e of v.evidence) {
      const c = refs.get(e.ref.trim().replace(/^\[|\]$/g, ''));
      if (!c || !quoteInText(e.quote, c.text)) continue;
      const key = `${c.docName}:${c.id}:${e.quote}`;
      if (seen.has(key)) continue;
      seen.add(key);
      evidence.push({
        side: 'after',
        docName: c.docName,
        clauseId: c.id,
        quote: e.quote.trim(),
        verified: true
      });
    }
    // Утверждение о соответствии или несоответствии без подтверждённой цитаты не показываем.
    if (v.status !== 'no_evidence' && !evidence.length) {
      return {
        ...base,
        status: 'no_evidence',
        evidence: [],
        note: `${humanRefs(v.note, refs)} (Цитата не подтверждена в тексте пункта — статус понижен до «не найдено в комплекте».)`
      };
    }
    return { ...base, status: v.status, evidence, note: humanRefs(v.note, refs) };
  });
}
