import type { ParsedClause } from './parse-clauses';
import { fnLine, type Fn } from './functions';
import { llmJson, S } from './llm';
import { clip, mapLimit } from './text';
import type { UnitDef } from './units';

const PARALLEL = 6;

// ---------- 1. Сопоставление изменённых функций «до» с кандидатами «после» ----------

export interface MatchVerdict {
  ref: string;
  verdict: 'same' | 'narrowed' | 'expanded' | 'lost';
  afterRefs: string[];
  lostPart: string;
  explanation: string;
  confidence: number;
  /** Первый проход счёл функцию утраченной, перепроверка нашла лишь частичное покрытие общими нормами */
  partialLoss?: boolean;
}

const MATCH_SCHEMA = S.obj({
  items: S.arr(
    S.obj({
      ref: S.str('ссылка пункта ДО, например B12'),
      verdict: S.enum('same', 'narrowed', 'expanded', 'lost'),
      afterRefs: S.arr(S.str('ссылка кандидата ПОСЛЕ, например A40')),
      lostPart: S.str('для narrowed — дословный фрагмент текста ДО, который утрачен; иначе пустая строка'),
      explanation: S.str('1–2 предложения: почему так решено'),
      confidence: S.num('0..1')
    })
  )
});

export async function judgeMatches(
  items: { fn: Fn; candidates: Fn[] }[],
  batchSize = 6
): Promise<MatchVerdict[]> {
  const batches: (typeof items)[] = [];
  for (let i = 0; i < items.length; i += batchSize) batches.push(items.slice(i, i + batchSize));

  const results = await mapLimit(batches, PARALLEL, async (batch) => {
    const body = batch
      .map(
        ({ fn, candidates }) =>
          `ДО ${fnLine(fn)}\n  Кандидаты ПОСЛЕ:\n${candidates.map((c) => `  ${fnLine(c, 400)}`).join('\n')}`
      )
      .join('\n\n');
    const prompt = `Сравниваем редакцию документа ДО и ПОСЛЕ реорганизации. Для каждого пункта ДО реши, сохранилась ли описанная в нём функция (обязанность/право) в редакции ПОСЛЕ среди его кандидатов.

verdict:
- same — смысл функции сохранён (возможно, другими словами и/или у другого подразделения);
- narrowed — функция сохранена лишь частично, объём сужен; в lostPart дословно из текста ДО укажи утраченную часть;
- expanded — функция сохранена и расширена;
- lost — ни один кандидат не покрывает функцию.
afterRefs — кандидаты, которые покрывают функцию (пусто для lost).
Носитель в скобках — для информации: передача функции другому подразделению — это same, а не lost.
Если среди кандидатов есть пункт ТОГО ЖЕ носителя с тем же смыслом — укажи именно его, а не похожую типовую обязанность другого подразделения.
Косметические правки (сокращения, порядок слов, уточнения без изменения смысла) — это same.

${body}`;
    const r = await llmJson<{ items: MatchVerdict[] }>('match_functions', MATCH_SCHEMA, prompt);
    return r.items;
  });
  return results.flat();
}

// ---------- 2. Самопроверка потерь: ищем покрытие по всему документу «после» ----------

export interface LossCheck {
  ref: string;
  verdict: 'covered' | 'partially' | 'not_covered';
  afterRefs: string[];
  explanation: string;
  confidence: number;
}

const LOSS_SCHEMA = S.obj({
  items: S.arr(
    S.obj({
      ref: S.str(),
      verdict: S.enum('covered', 'partially', 'not_covered'),
      afterRefs: S.arr(S.str()),
      explanation: S.str(),
      confidence: S.num()
    })
  )
});

export async function recheckLosses(items: { fn: Fn; candidates: Fn[] }[]): Promise<LossCheck[]> {
  const results = await mapLimit(
    items.map((x) => [x]),
    PARALLEL,
    async ([{ fn, candidates }]) => {
      const prompt = `Первый проход пометил функцию из редакции ДО как утраченную. Перепроверь это: просмотри пункты редакции ПОСЛЕ (из любых разделов) и реши, покрыта ли функция.
verdict: covered — покрыта (в т.ч. другими словами или другим подразделением); partially — покрыта частично; not_covered — нигде не покрыта.
Будь строгим: not_covered только если ни один пункт не выполняет эту функцию.

ДО ${fnLine(fn)}

Пункты ПОСЛЕ:
${candidates.map((c) => fnLine(c, 400)).join('\n')}`;
      const r = await llmJson<{ items: LossCheck[] }>('recheck_loss', LOSS_SCHEMA, prompt, { effort: 'medium' });
      return r.items.map((x) => ({ ...x, ref: fn.ref }));
    }
  );
  return results.flat();
}

// ---------- 3. Дублирование и пересечение зон ответственности ----------

export interface DupVerdict {
  pair: string;
  verdict: 'duplication' | 'overlap' | 'generic' | 'different';
  explanation: string;
  recommendation: string;
  confidence: number;
}

const DUP_SCHEMA = S.obj({
  items: S.arr(
    S.obj({
      pair: S.str('номер пары, например P3'),
      verdict: S.enum('duplication', 'overlap', 'generic', 'different'),
      explanation: S.str(),
      recommendation: S.str('как устранить, если есть проблема; иначе пустая строка'),
      confidence: S.num()
    })
  )
});

export async function judgeDuplicates(pairs: { id: string; a: Fn; b: Fn }[]): Promise<DupVerdict[]> {
  const batches: (typeof pairs)[] = [];
  for (let i = 0; i < pairs.length; i += 8) batches.push(pairs.slice(i, i + 8));
  const results = await mapLimit(batches, PARALLEL, async (batch) => {
    const prompt = `Ниже пары пунктов из НОВОЙ редакции, закреплённые за разными подразделениями. Для каждой пары классифицируй:
- duplication — одна и та же содержательная работа над одним объектом поручена двум подразделениям (дублирование функций);
- overlap — зоны ответственности частично пересекаются (размытая ответственность, риск конфликта);
- generic — типовая управленческая обязанность, которая нормально есть у каждого руководителя (например, «выполняет поручения», «вносит предложения по обучению»), — не проблема;
- different — функции разные.
Для duplication и overlap дай рекомендацию по устранению.

${batch.map((p) => `${p.id}:\n  ${fnLine(p.a, 400)}\n  ${fnLine(p.b, 400)}`).join('\n\n')}`;
    const r = await llmJson<{ items: DupVerdict[] }>('judge_duplicates', DUP_SCHEMA, prompt);
    return r.items;
  });
  return results.flat();
}

// ---------- 4. Конфликт интересов ----------

/** Каталог «красных флагов» независимости и разделения обязанностей (IIA GIAS 2024, модель трёх линий, COSO). */
export const COI_RULES = [
  'R1. Самоконтроль: подразделение проверяет или оценивает качество работы, которую само выполняет (аудит собственной работы).',
  'R2. Совмещение консультирования/участия в разработке процедур и последующего аудита тех же процедур или объектов.',
  'R3. Участие руководителя или работников аудита в органах управления, руководстве или операционной деятельности проверяемых обществ/подразделений.',
  'R4. Подчинённость или отчётность аудита лицу/органу, чью деятельность он проверяет, ограничивающая независимость.',
  'R5. Одно подразделение формирует план/программу, исполняет её и само оценивает результаты исполнения.',
  'R6. Совмещение функций первой/второй линии (управление рисками, внутренний контроль, согласование документов и договоров) с третьей линией (аудит).',
  'R7. Одно лицо согласовывает или утверждает документ и затем проверяет его исполнение.',
  'R8. Функция контроля качества аудита подчинена тому, чью работу она контролирует, или выполняется им же.',
  'R9. Прямо упомянутые в документе совмещения должностей, конфликт интересов (КИ), угрозы независимости и объективности.'
];

export interface CoiItem {
  title: string;
  detail: string;
  rule: string;
  holders: string[];
  refs: { ref: string; quote: string }[];
  severity: 'high' | 'medium' | 'low';
  confidence: number;
  recommendation: string;
}

const COI_SCHEMA = S.obj({
  items: S.arr(
    S.obj({
      title: S.str('формулировка-гипотеза: «Признаки конфликта интересов: …»'),
      detail: S.str('2–3 предложения: в чём риск'),
      rule: S.str('код правила, например R3'),
      holders: S.arr(S.str('наименование или аббревиатура подразделения/должности')),
      refs: S.arr(S.obj({ ref: S.str('ссылка пункта, например A40'), quote: S.str('дословная цитата из этого пункта') })),
      severity: S.enum('high', 'medium', 'low'),
      confidence: S.num(),
      recommendation: S.str()
    })
  )
});

export async function findConflicts(fns: Fn[], extra: Fn[]): Promise<CoiItem[]> {
  const byHolder = new Map<string, Fn[]>();
  for (const f of [...fns, ...extra]) {
    const key = f.holders.length ? f.holders.map((h) => h.abbr ?? h.name).join(', ') : 'Блок в целом';
    if (!byHolder.has(key)) byHolder.set(key, []);
    if (!byHolder.get(key)!.includes(f)) byHolder.get(key)!.push(f);
  }
  const listing = [...byHolder.entries()]
    .map(([h, list]) => `### ${h}\n${list.map((f) => `[${f.ref}] п. ${f.clause.id}: «${clip(f.clause.text, 260)}»`).join('\n')}`)
    .join('\n\n');
  const prompt = `Проверь НОВУЮ редакцию на потенциальный конфликт интересов и нарушение разделения обязанностей. Используй каталог правил:
${COI_RULES.join('\n')}

Ниже функции новой редакции, сгруппированные по носителям. Найди только случаи, подтверждённые текстом: каждый вывод — со ссылками на пункты и дословными цитатами из них. Не выдумывай; лучше меньше, но обоснованно (обычно 2–6 случаев). Формулировки — гипотезы для проверки сотрудником.

${listing}`;
  const r = await llmJson<{ items: CoiItem[] }>('find_conflicts', COI_SCHEMA, prompt, { effort: 'medium' });
  return r.items;
}

// ---------- 5. Состав подразделений, если правило не сработало ----------

export interface LlmUnit {
  name: string;
  abbr: string;
  kind: 'unit' | 'position';
  clauseId: string;
  quote: string;
  positions: string[];
}

const UNITS_SCHEMA = S.obj({
  units: S.arr(
    S.obj({
      name: S.str('полное наименование в именительном падеже'),
      abbr: S.str('аббревиатура из документа или пустая строка'),
      kind: S.enum('unit', 'position'),
      clauseId: S.str('номер пункта, где подразделение названо'),
      quote: S.str('дословная цитата из этого пункта'),
      positions: S.arr(S.str('должность в подчинении'))
    })
  )
});

export async function extractUnitsLLM(clauses: ParsedClause[]): Promise<LlmUnit[]> {
  const relevant = clauses
    .filter((c) => /департамент|управлени|отдел|служб|центр|сектор|дирекци|подчиня|штат|структур/iu.test(c.text))
    .slice(0, 150);
  const prompt = `Определи состав организационной структуры по документу: структурные подразделения (unit) и самостоятельные руководящие должности вне подразделений (position), с должностями в подчинении. Только то, что прямо следует из текста.

${relevant.map((c) => `п. ${c.id}: «${clip(c.text, 300)}»`).join('\n')}`;
  const r = await llmJson<{ units: LlmUnit[] }>('extract_units', UNITS_SCHEMA, prompt, { effort: 'medium' });
  return r.units;
}

// ---------- 6. Итоговое заключение ----------

export interface ConclusionDraft {
  summary: string;
  sections: { title: string; text: string; findingIds: string[] }[];
  recommendations: { text: string; findingIds: string[] }[];
}

const CONCLUSION_SCHEMA = S.obj({
  summary: S.str('3–5 предложений для руководителя'),
  sections: S.arr(S.obj({ title: S.str(), text: S.str(), findingIds: S.arr(S.str()) })),
  recommendations: S.arr(S.obj({ text: S.str(), findingIds: S.arr(S.str()) }))
});

export async function writeConclusion(digest: string): Promise<ConclusionDraft> {
  const prompt = `Составь итоговое аналитическое заключение по результатам сравнения оргструктуры и функций ДО и ПОСЛЕ реорганизации. Пиши понятно для сотрудника, проводящего анализ: разделы «Изменения структуры», «Потеря и сужение функций», «Дублирование и пересечения», «Конфликт интересов» (пропусти раздел, если по нему нет выводов). Опирайся ТОЛЬКО на выводы ниже, в findingIds указывай id выводов, на которых основан текст. Формулировки — гипотезы, требующие проверки. Рекомендации — конкретные (кому передать функцию, как разделить обязанности).

${digest}`;
  return llmJson<ConclusionDraft>('write_conclusion', CONCLUSION_SCHEMA, prompt);
}

export type { UnitDef };
