import type { ParsedClause } from './parse-clauses';
import { jaccard, norm } from './text';

/**
 * Дефекты перекрёстных ссылок новой редакции — детерминированно, без LLM.
 *
 * missing — ссылка на пункт, которого нет в документе;
 * shifted — текст ссылающегося пункта не менялся, но после перенумерации по старому номеру
 *           оказалось другое содержание, а прежнее переехало (например, «п. 5.8.1» теперь запрет, а не право).
 */
export interface RefDefect {
  kind: 'missing' | 'shifted';
  clause: ParsedClause;
  ref: string;
  /** Что сейчас по этому номеру в новой редакции */
  target?: ParsedClause;
  /** На что ссылка указывала в прежней редакции */
  beforeTarget?: ParsedClause;
  /** Куда переехало прежнее содержание */
  movedTo?: ParsedClause;
}

/** «п. 5.8.1 и 5.8.2», «пп. 3.4, 3.5» — номера после «п.»/«пп.». */
const REF_RE = /(?<![\p{L}])пп?\.\s*((?:\d{1,2}(?:\.\d{1,3})+\.?(?:\s*(?:,|и)\s*)?)+)/gu;
/** Ссылка на другой документ («п. 3.2 Устава») — не проверяем. */
const OTHER_DOC = /^\s*(устав|политик|кодекс|закон|фз|регламент|правил|приказ|стандарт)/iu;

function refsOf(c: ParsedClause): string[] {
  const out: string[] = [];
  for (const m of c.text.matchAll(REF_RE)) {
    const tail = c.text.slice((m.index ?? 0) + m[0].length);
    if (OTHER_DOC.test(tail)) continue;
    for (const n of m[1].match(/\d{1,2}(?:\.\d{1,3})+/g) ?? []) if (n !== c.id) out.push(n);
  }
  return [...new Set(out)];
}

export function findRefDefects(before: ParsedClause[], after: ParsedClause[]): RefDefect[] {
  const out: RefDefect[] = [];
  const beforeByText = new Set(before.map((c) => norm(c.text)));
  for (const docName of new Set(after.map((c) => c.docName))) {
    const doc = after.filter((c) => c.docName === docName);
    const byId = new Map(doc.map((c) => [c.id, c]));
    const sections = new Set(doc.map((c) => c.section));
    for (const c of doc) {
      for (const ref of refsOf(c)) {
        const target = byId.get(ref);
        if (!target) {
          if (sections.has(ref.split('.')[0])) out.push({ kind: 'missing', clause: c, ref });
          continue;
        }
        // Пункт переписан — значит, ссылку в нём обновляли сознательно.
        if (!beforeByText.has(norm(c.text))) continue;
        const beforeTarget = before.find((b) => b.id === ref);
        if (!beforeTarget || norm(beforeTarget.text) === norm(target.text)) continue;
        const toOld = jaccard(c.text, beforeTarget.text);
        const toNew = jaccard(c.text, target.text);
        if (toOld <= toNew + 0.05) continue;
        const movedTo = doc.find((x) => x.id !== ref && jaccard(x.text, beforeTarget.text) >= 0.7);
        if (movedTo) out.push({ kind: 'shifted', clause: c, ref, target, beforeTarget, movedTo });
      }
    }
  }
  return out;
}
