import type { DocSide } from '../types';
import type { ParsedClause } from './parse-clauses';
import { holdersOf, type UnitDef } from './units';
import { clip, norm } from './text';

/** Функция = пункт документа, описывающий обязанность или право, с носителями. */
export interface Fn {
  /** Уникален в пределах анализа: сторона + документ + пункт */
  uid: string;
  /** Короткая ссылка для промптов: "B17" / "A203" */
  ref: string;
  side: DocSide;
  clause: ParsedClause;
  holders: UnitDef[];
  /** Вводная часть родительского пункта — контекст для подпунктов-перечней */
  context: string;
}

/** Разделы, где нет функций подразделений: общие положения, структура (её разбирает units.ts), термины. */
const NON_FUNCTION_SECTION = /преамбула|общие положения|структура|термин|определени|заключительн|приложени/iu;
const ROLE_HEADER = /^(главн\p{L}*\s+аудитор|директор|руководител|работник|начальник|департамент|управлени|отдел|служб|сектор|центр|групп|дирекци)/iu;

export const clauseUid = (c: ParsedClause) => `${c.side}:${c.docName}:${c.id}`;

/** Документы комплекта: носитель по умолчанию и распорядительные документы (приказ), где пункты — поручения, а не функции. */
export interface DocContext {
  owners?: Map<string, UnitDef>;
  orders?: Set<string>;
}

export function buildFunctions(clauses: ParsedClause[], units: UnitDef[], side: DocSide, docs: DocContext = {}): Fn[] {
  const byDoc = new Map<string, Map<string, ParsedClause>>();
  for (const c of clauses) {
    if (!byDoc.has(c.docName)) byDoc.set(c.docName, new Map());
    byDoc.get(c.docName)!.set(c.id, c);
  }
  const hasChildren = new Set(clauses.filter((c) => c.parentId).map((c) => `${c.docName}#${c.parentId}`));

  const out: Fn[] = [];
  for (const c of clauses) {
    // Строки таблицы оргструктуры описывают состав, а не функции — их разбирает units.ts.
    if (c.cells || NON_FUNCTION_SECTION.test(c.sectionTitle) || docs.orders?.has(c.docName)) continue;
    const text = c.text.trim();
    if (norm(text).length < 15) continue;
    // Вводные строки перечней («5.3. Директор ДОА:», «…осуществляет следующие функции:») — не функции.
    if (text.endsWith(':') && hasChildren.has(`${c.docName}#${c.id}`) && (ROLE_HEADER.test(text) || /следующ/iu.test(text))) {
      continue;
    }
    const byId = byDoc.get(c.docName)!;
    const parent = c.parentId ? byId.get(c.parentId) : undefined;
    out.push({
      uid: clauseUid(c),
      ref: `${side === 'before' ? 'B' : 'A'}${out.length + 1}`,
      side,
      clause: c,
      holders: holdersOf(c, byId, units, docs.owners?.get(c.docName)),
      context: parent && parent.text.trim().endsWith(':') ? clip(parent.text, 200) : ''
    });
  }
  return out;
}

export const holderLabel = (f: Fn) =>
  f.holders.length ? f.holders.map((h) => h.abbr ?? h.name).join(', ') : 'блок в целом';

/** Строка функции для промпта: ссылка, пункт, носитель, контекст перечня, текст. */
export function fnLine(f: Fn, maxLen = 600): string {
  const ctx = f.context ? ` [перечень: «${f.context}»]` : '';
  return `[${f.ref}] п. ${f.clause.id} (${holderLabel(f)})${ctx}: «${clip(f.clause.text, maxLen)}»`;
}

export const sameHolders = (a: Fn, b: Fn) => {
  const ka = new Set(a.holders.map((h) => h.key));
  const kb = new Set(b.holders.map((h) => h.key));
  return ka.size === kb.size && [...ka].every((k) => kb.has(k));
};
