import type { Clause, DocSide } from '../types';
import type { TableSheet } from './load-doc';

/** Пункт с внутренними полями пайплайна, которые не уходят в интерфейс. */
export interface ParsedClause extends Clause {
  /** id родительского пункта: "5.3" для "5.3.2", "5.3.2" для "5.3.2.а" */
  parentId?: string;
  /** Ненумерованный заголовок роли над пунктом («Главный аудитор:») */
  roleHint?: string;
  /** Строка таблицы (Excel): заголовок столбца → значение */
  cells?: Record<string, string>;
  /** Полный текст строки «N. …» раздела и длина отделённого от заголовка текста — для плоской нумерации */
  heading?: string;
  bodyLen?: number;
}

/** "1. Общие положения" — заголовок раздела верхнего уровня. */
const SECTION_RE = /^(\d{1,2})\.\s+(.+)$/;
/** "3.4." / "2.3.1." — нумерованный пункт. */
const CLAUSE_RE = /^(\d{1,2}(?:\.\d{1,3})+)\.?\s*(.*)$/;
/** Раздел с римским номером или словом: «II. Цели», «Раздел III. Права», «ГЛАВА 2», «Глава IV». */
const ROMAN_SECTION_RE = /^(?:(?:раздел|глава)\s+([IVXLCІХС]{1,6}|\d{1,2})\.?(?:\s+(.*))?|([IVXLCІХС]{1,6})\.\s+(\S.*))$/iu;
/** Пункт до первого заголовка раздела: «1.1. Текст» — только с точкой и текстом, чтобы не ловить даты шапки. */
const STRICT_CLAUSE_RE = /^\d{1,2}(?:\.\d{1,3})+\.\s+\p{L}/u;

/** Римское число → арабское (с кириллическими двойниками І, Х, С). */
function romanToInt(raw: string): number {
  const r = raw.toUpperCase().replace(/І/g, 'I').replace(/Х/g, 'X').replace(/С/g, 'C');
  const v: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
  let n = 0;
  for (let i = 0; i < r.length; i++) {
    const a = v[r[i]] ?? 0;
    const b = v[r[i + 1]] ?? 0;
    n += a < b ? -a : a;
  }
  return n;
}
/** "а." / "б)" — буквенный подпункт внутри последнего пункта. */
const LETTER_RE = /^([а-яё])[.)]\s+(.+)$/i;
/** "– текст" / "- текст" — маркированный элемент перечня. */
const DASH_RE = /^[–—-]\s+(.+)$/;
/** Строка оглавления: "3. СТРУКТУРА И ОРГАНИЗАЦИЯ РАБОТЫ 8". */
const TOC_RE = /^(\d{1,2})\.\s+([А-ЯЁA-Z«»"().,\s-]+?)\s+\d+(?:\s|$)/;

/**
 * Пункты, склеенные в один абзац при конвертации ("… Общества. 3.10.Работники …"),
 * разрезаются по номеру пункта после знака конца предложения. Ссылки вида
 * «п. 3.4.» не режутся — перед ними стоит «п.».
 */
function splitGluedClauses(line: string): string[] {
  return line
    .split(/(?<=[^\d\s][.;:])\s*(?<!\sп\.\s?)(?<!\sпп\.\s?)(?=\d{1,2}\.\d{1,3}\.(?:\d{1,3}\.)*\s*[А-ЯЁA-Zа-яё])/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

const upperNorm = (s: string) => s.toUpperCase().replace(/Ё/g, 'Е').replace(/\s+/g, ' ').trim();

/**
 * Заголовок раздела, склеенный с первым абзацем ("4. Внутренний аудит в ДЗО При взаимодействии…"),
 * разделяется по оглавлению документа, а без оглавления — по первому слову с заглавной буквы.
 */
function splitSectionTitle(num: string, rest: string, toc: Map<string, string>): [string, string] {
  const tocTitle = toc.get(num);
  if (tocTitle) {
    const head = upperNorm(rest).slice(0, tocTitle.length);
    if (head === tocTitle) {
      return [rest.slice(0, tocTitle.length).trim(), rest.slice(tocTitle.length).trim()];
    }
  }
  if (rest.length <= 90) return [rest, ''];
  const m = rest.match(/^(.{5,90}?[а-яёА-ЯЁ.)])\s+([А-ЯЁ][а-яё].*)$/u);
  return m ? [m[1], m[2]] : [rest, ''];
}

/**
 * Режет текст положения на пункты с сохранением их номеров.
 *
 * Номер пункта — единственное, на что можно сослаться в выводе (must have 4 ТЗ),
 * поэтому парсер консервативен: строка, которую не удалось опознать, приклеивается
 * к предыдущему пункту, а не теряется и не порождает пункт с выдуманным номером.
 */
export function parseClauses(raw: string, side: DocSide, docName: string): ParsedClause[] {
  const allLines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^_+$/.test(l));

  // Оглавление в конце документа: запоминаем заголовки и отрезаем его вместе с перечнем приложений.
  const toc = new Map<string, string>();
  let end = allLines.length;
  for (let i = 0; i < allLines.length; i++) {
    if (/^(оглавление|содержание)$/i.test(allLines[i]) && i > allLines.length / 2) {
      end = i;
      break;
    }
  }
  for (const l of allLines.slice(end)) {
    const m = l.match(TOC_RE);
    if (m) toc.set(m[1], upperNorm(m[2]));
  }

  const lines = allLines.slice(0, end).flatMap(splitGluedClauses);
  const clauses: ParsedClause[] = [];

  let section = '0';
  let sectionTitle = 'Преамбула';
  let roleHint: string | undefined;
  let current: ParsedClause | null = null;
  const seenSections = new Set<string>();

  const push = () => {
    if (current && (current.text.trim() || current.heading)) clauses.push(current);
    current = null;
  };

  const parentOf = (id: string) => (id.includes('.') ? id.slice(0, id.lastIndexOf('.')) : undefined);

  // Документ с римскими разделами: арабские «1.», «2.» внутри — это пункты раздела, а не новые разделы.
  let romanMode = false;

  for (const line of lines) {
    const romanM = line.match(ROMAN_SECTION_RE);
    if (romanM) {
      const token = romanM[1] ?? romanM[3];
      const num = String(/^\d+$/.test(token) ? Number(token) : romanToInt(token));
      const titleText = (romanM[2] ?? romanM[4] ?? '').trim();
      const isToc = /\s\d+$/.test(titleText) && titleText.toUpperCase() === titleText;
      if (num !== '0' && !isToc && !seenSections.has(num)) {
        romanMode = true;
        seenSections.add(num);
        push();
        section = num;
        sectionTitle = (titleText || `Раздел ${num}`).replace(/[.:]$/, '').trim();
        roleHint = undefined;
        continue;
      }
    }

    const clauseM = line.match(CLAUSE_RE);
    // Пункт «1.1. Текст» до первого заголовка раздела — документ без заголовков разделов.
    if (clauseM && section === '0' && STRICT_CLAUSE_RE.test(line)) {
      section = clauseM[1].split('.')[0];
      seenSections.add(section);
      sectionTitle = `Раздел ${section}`;
    }
    if (clauseM && section !== '0') {
      push();
      // В римском разделе нумерация пунктов может начинаться заново («1.1» внутри «II») — добавляем номер раздела.
      const id = romanMode && clauseM[1].split('.')[0] !== section ? `${section}.${clauseM[1]}` : clauseM[1];
      const sec = id.split('.')[0];
      if (sec !== section && !seenSections.has(sec)) {
        // Раздел без заголовка в тексте (есть только в оглавлении) — берём название оттуда.
        seenSections.add(sec);
        const t = toc.get(sec);
        sectionTitle = t ? t.charAt(0) + t.slice(1).toLowerCase() : `Раздел ${sec}`;
        roleHint = undefined;
      }
      section = sec;
      current = { id, section, sectionTitle, text: clauseM[2] ?? '', side, docName, parentId: parentOf(id), roleHint };
      continue;
    }

    const sectionM = line.match(SECTION_RE);
    // Арабский «N. текст» внутри римского раздела — пункт этого раздела.
    if (sectionM && romanMode && section !== '0') {
      push();
      const id = `${section}.${sectionM[1]}`;
      current = { id, section, sectionTitle, text: sectionM[2], side, docName, parentId: section, roleHint };
      continue;
    }
    if (sectionM) {
      const isToc = /\s\d+$/.test(sectionM[2]) && sectionM[2].toUpperCase() === sectionM[2];
      if (!isToc && !seenSections.has(sectionM[1])) {
        seenSections.add(sectionM[1]);
        push();
        section = sectionM[1];
        const [title, body] = splitSectionTitle(section, sectionM[2], toc);
        sectionTitle = title.replace(/\s+\d+$/, '').replace(/[.:]$/, '').trim();
        roleHint = undefined;
        // Текст, идущий сразу за заголовком, сохраняем как пункт «N» — иначе он потеряет адрес.
        current = { id: section, section, sectionTitle, text: body, side, docName, heading: sectionM[2], bodyLen: body.length };
        continue;
      }
    }

    if (section === '0') continue; // шапка «УТВЕРЖДЕНО…» — не пункты

    // Ненумерованный заголовок роли: «Главный аудитор:»
    if (/^[А-ЯЁ][^.:;]{2,80}:$/u.test(line) && !/^[а-яё][.)]/i.test(line)) {
      push();
      roleHint = line.replace(/:$/, '');
      continue;
    }

    const letterM = line.match(LETTER_RE);
    if (letterM && current) {
      // Родителя читаем ДО push() — он обнуляет current. Подпункт буквы наследует номер пункта.
      const parent: ParsedClause = current;
      const baseId = parent.id.replace(/\.[а-яё](#\d+)?$/, '');
      push();
      clauses.push({
        id: `${baseId}.${letterM[1].toLowerCase()}`,
        section,
        sectionTitle,
        text: letterM[2],
        side,
        docName,
        parentId: baseId,
        roleHint: parent.roleHint
      });
      // Буквенные подпункты идут подряд — держим родителя для следующего.
      current = { ...parent, id: baseId, text: '' };
      continue;
    }

    const dashM = line.match(DASH_RE);
    if (dashM && current) {
      current.text += (current.text ? '\n' : '') + '— ' + dashM[1];
      continue;
    }

    if (current) current.text += (current.text ? ' ' : '') + line;
  }
  push();

  // Плоская нумерация («1. Создать Департамент …», «2. Упразднить …» в приказе): у раздела нет подпунктов,
  // а «заголовок» — это законченная фраза. Возвращаем её в текст пункта, иначе пункт потеряется или обрежется.
  const withSub = new Set(clauses.filter((c) => c.id !== c.section).map((c) => c.section));
  for (const c of clauses) {
    if (c.id !== c.section || c.heading === undefined || withSub.has(c.section)) continue;
    if (!/[.;:!?]$/u.test(c.heading.trim()) || c.heading.length < 30) continue;
    const rest = c.text.slice(c.bodyLen ?? 0);
    c.text = c.bodyLen ? `${c.heading}${rest}` : [c.heading, rest].filter(Boolean).join(' ');
    c.sectionTitle = `Пункт ${c.id}`;
  }

  // Под одним пунктом бывает два буквенных перечня подряд, из-за чего "9.3.а" встречается дважды.
  // Ссылка на источник должна быть однозначной, поэтому повтор получает суффикс вхождения.
  const used = new Map<string, number>();
  return clauses
    .map(({ heading: _h, bodyLen: _b, ...c }) => c)
    .filter((c) => c.text.trim().length > 0)
    .map((c) => {
      const seen = used.get(c.id) ?? 0;
      used.set(c.id, seen + 1);
      return seen === 0 ? c : { ...c, id: `${c.id}#${seen + 1}` };
    });
}

/** Столбец с наименованием подразделения — признак строки заголовка таблицы оргструктуры/штатного расписания. */
export const UNIT_COLUMN = /подразделени|структурн|наименование|департамент|отдел|управлени/iu;

/**
 * Таблица Excel (оргструктура, штатное расписание) → пункты-строки. Адрес пункта — «лист, стр. N»,
 * текст — ячейки строки через « | », а в cells — значения по заголовкам столбцов для разбора состава.
 */
export function parseTable(sheets: TableSheet[], side: DocSide, docName: string): ParsedClause[] {
  const out: ParsedClause[] = [];
  sheets.forEach(({ sheet, rows }, si) => {
    const prefix = sheets.length > 1 ? `${sheet}, ` : '';
    const hi = rows.slice(0, 10).findIndex((r) => r.cells.filter(Boolean).length >= 2 && r.cells.some((c) => UNIT_COLUMN.test(c)));
    const header = hi >= 0 ? rows[hi].cells : undefined;
    // Объединённые ячейки: наименование подразделения указано в первой строке группы — протягиваем вниз.
    const carry: string[] = [];
    rows.forEach((r, i) => {
      if (header && i <= hi) return;
      const text = r.cells.filter(Boolean).join(' | ');
      if (!text) return;
      let cells: Record<string, string> | undefined;
      if (header) {
        const row: Record<string, string> = {};
        header.forEach((h, k) => {
          const v = r.cells[k] || (UNIT_COLUMN.test(h) ? carry[k] : '') || '';
          if (r.cells[k]) carry[k] = r.cells[k];
          if (h && v) row[h] = v;
        });
        cells = row;
      }
      out.push({ id: `${prefix}стр. ${r.row}`, section: String(si + 1), sectionTitle: `Таблица «${sheet}»`, text, side, docName, cells });
    });
  });
  return out;
}

/** Публичная форма пункта — без внутренних полей. */
export function toPublicClause(c: ParsedClause): Clause {
  return { id: c.id, side: c.side, docName: c.docName, section: c.section, sectionTitle: c.sectionTitle, text: c.text };
}
