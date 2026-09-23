import type { DocSide, Evidence } from '../types';
import type { ParsedClause } from './parse-clauses';
import { norm, stemRegex } from './text';

/** Подразделение или самостоятельная должность одной стороны сравнения. */
export interface UnitDef {
  /** Ключ сопоставления «до/после»: одинаковый у одного и того же подразделения */
  key: string;
  name: string;
  abbr?: string;
  kind: 'unit' | 'position';
  side: DocSide;
  /** Документ комплекта, где подразделение названо: номера пунктов в разных документах совпадают */
  docName: string;
  clauseId: string;
  quote: string;
  positions: string[];
  positionsClauseId?: string;
}

/** Слова, с которых начинается наименование структурного подразделения. */
const UNIT_WORD = /^(?:Департамент|Управление|Отдел|Служба|Дирекция|Блок|Центр|Сектор|Группа|Бюро|Лаборатория|Филиал|Представительство)\s/u;
/** Вводная фраза состава: «состоит из следующих подразделений», «В состав Департамента входят:», «включает». */
const COMPOSITION_RE =
  /(?:состоит из следующих(?: структурных)? подразделений|в\s+(?:свой\s+)?состав\s+[^:.;]{0,80}?\s*вход(?:ят|ит)|состоит из|включает(?:\s+в\s+себя)?(?:\s+следующие\s+(?:структурные\s+)?подразделения)?)\s*:?\s*/iu;

/** Строки таблицы оргструктуры/штатного расписания → подразделения с должностями. */
function structureFromTable(clauses: ParsedClause[]): UnitDef[] {
  const rows = clauses.filter((c) => c.cells && Object.keys(c.cells).length);
  if (!rows.length) return [];
  const col = (re: RegExp, except?: RegExp) => (r: ParsedClause) =>
    Object.entries(r.cells!).find(([h]) => re.test(h) && !except?.test(h))?.[1];
  const unitOf = col(/подразделени|структурн|наименование|департамент|отдел|управлени/iu, /должност|руковод/iu);
  const abbrOf = col(/сокращ|аббрев|краткое|код/iu);
  const headOf = col(/руководител|начальник|директор|глава/iu);
  const posOf = col(/должност|штатн|позици/iu, /кол|числ|оклад/iu);

  const out = new Map<string, UnitDef>();
  for (const r of rows) {
    const name = unitOf(r)?.trim();
    if (!name) continue;
    const abbr = abbrOf(r)?.match(/^[А-ЯЁA-Z]{2,12}$/u)?.[0] ?? name.match(/\(([А-ЯЁA-Z]{2,12})\)/u)?.[1];
    const key = unitKey(name.replace(/\s*\([^)]*\)\s*$/u, ''), abbr);
    let u = out.get(key);
    if (!u) {
      u = { key, name: name.replace(/\s*\([А-ЯЁA-Z]{2,12}\)\s*$/u, ''), abbr, kind: 'unit', side: r.side, docName: r.docName, clauseId: r.id, quote: r.text, positions: [], positionsClauseId: r.id };
      out.set(key, u);
    }
    for (const p of [headOf(r), ...(posOf(r)?.split(/[;\n]|,\s*(?=[А-ЯЁ])/u) ?? [])]) {
      const t = p?.trim().replace(/[.;]$/, '');
      if (t && !u.positions.includes(t)) u.positions.push(t);
    }
  }
  return [...out.values()];
}

/** «В состав Департамента входят: Отдел бюджетирования, Отдел казначейства и Отдел налогового учёта.» */
function structureFromInlineList(clauses: ParsedClause[]): UnitDef[] {
  const out: UnitDef[] = [];
  for (const c of clauses) {
    const m = c.text.match(COMPOSITION_RE);
    if (!m) continue;
    const tail = c.text.slice(m.index! + m[0].length);
    for (const raw of tail.split(/[,;]|\s+и\s+(?=\p{Lu})|\.\s|\.$/u)) {
      const item = raw.trim().replace(/[.;]$/, '');
      if (!UNIT_WORD.test(item) || item.length > 140) continue;
      const am = item.match(/^(.+?)\s*\(([А-ЯЁA-Z]{2,12})\)$/u);
      const name = am ? am[1] : item;
      if (out.some((u) => u.key === unitKey(name, am?.[2]))) continue;
      out.push({
        key: unitKey(name, am?.[2]),
        name,
        abbr: am?.[2],
        kind: 'unit',
        side: c.side,
        docName: c.docName,
        clauseId: c.id,
        // Короткое наименование («Отдел ИТ») цитатой не считается — тогда цитируем весь пункт.
        quote: item.length >= 12 ? item : c.text,
        positions: []
      });
    }
  }
  return out;
}

/** "Департамент операционного аудита (ДОА)." → имя + аббревиатура. */
const UNIT_RE =
  /^((?:Департамент|Управление|Отдел|Служба|Дирекция|Блок|Центр|Сектор|Группа)\s+[^.(]{3,120}?)\s*(?:\(([А-ЯЁA-Z]{2,12})\))?\s*[.;]?$/u;
/** "Директору ДНМ подчиняются работники …" / "Главному аудитору подчиняются …" */
const SUBORD_RE = /^(.{3,120}?)\s+подчиня(?:ю|е)тся/iu;

const ROLE_START =
  /^(главн\p{L}*\s+аудитор|директор|руководител|работник|начальник|заместител|менеджер|департамент|управлени|отдел|служб|центр|сотрудник)/iu;

export const unitKey = (name: string, abbr?: string) => (abbr ? abbr.toUpperCase() : norm(name));

/** Именительный падеж для «Главному аудитору» / «Директору направления …». */
function toNominative(owner: string): string {
  return owner
    .replace(/^Главному аудитору/iu, 'Главный аудитор')
    .replace(/^(Директору|Руководителю|Начальнику|Заместителю)/iu, (w) => w.slice(0, -1))
    .trim();
}

/** Подпункты пункта того же документа: номера пунктов в разных документах комплекта совпадают. */
const childrenOf = (clauses: ParsedClause[], parent: ParsedClause) =>
  clauses.filter((c) => c.parentId === parent.id && c.docName === parent.docName);

/** Подразделения, перечисленные подпунктами под вводной фразой состава. */
function structureFromAnchor(clauses: ParsedClause[], anchorRe: RegExp): UnitDef[] {
  const out: UnitDef[] = [];
  for (const anchor of clauses.filter((c) => anchorRe.test(c.text))) {
    for (const c of childrenOf(clauses, anchor)) {
      const m = c.text.trim().match(UNIT_RE);
      if (!m || out.some((u) => u.key === unitKey(m[1], m[2]))) continue;
      out.push({
        key: unitKey(m[1], m[2]),
        name: m[1].trim(),
        abbr: m[2],
        kind: 'unit',
        side: c.side,
        docName: c.docName,
        clauseId: c.id,
        quote: c.text.trim(),
        positions: []
      });
    }
    if (out.length) break;
  }
  return out;
}

/**
 * Состав подразделений и самостоятельных должностей по разделу «Структура» (must have 1).
 * Сделано правилом, а не LLM: состав — фундамент всех выводов и должен быть воспроизводимым.
 * Порядок правил: перечень подпунктами под «состоит из следующих подразделений» → то же под
 * «В состав … входят:» → перечень в строку через запятую → строки таблицы Excel.
 * Если правила ничего не нашли (другой формат документа), состав извлекает LLM — см. analyze.ts.
 */
export function extractStructure(clauses: ParsedClause[]): UnitDef[] {
  const out: UnitDef[] = [];
  for (const docName of new Set(clauses.map((c) => c.docName))) {
    const doc = clauses.filter((c) => c.docName === docName && !c.cells);
    let found = structureFromAnchor(doc, /состоит из следующих (?:структурных )?подразделений/iu);
    if (!found.length) found = structureFromAnchor(doc, COMPOSITION_RE);
    if (!found.length) found = structureFromInlineList(doc);
    for (const u of [...found, ...structureFromTable(clauses.filter((c) => c.docName === docName && c.cells))]) {
      if (!out.some((x) => x.key === u.key)) out.push(u);
    }
  }

  // Линии подчинённости: владелец перечня + должности буквенными подпунктами.
  for (const c of clauses) {
    const m = c.text.match(SUBORD_RE);
    if (!m) continue;
    const owner = toNominative(m[1]);
    const children = childrenOf(clauses, c);
    const items = children.map((k) => k.text.trim().replace(/[.;]$/, ''));
    if (!items.length) continue;

    // Должности и подразделение — из одного документа: ссылка на пункт должностей строится по документу подразделения.
    const ownerUnit = resolveHolders(owner, out.filter((u) => u.docName === c.docName), { strict: true })[0];
    if (ownerUnit) {
      ownerUnit.positions = items;
      ownerUnit.positionsClauseId = c.id;
      continue;
    }

    // Владелец — должность вне подразделений (Главный аудитор, Директор направления …).
    let pos = out.find((u) => u.kind === 'position' && stemRegex(u.name)?.test(norm(owner)));
    if (!pos) {
      pos = { key: unitKey(owner), name: owner, kind: 'position', side: c.side, docName: c.docName, clauseId: c.id, quote: c.text, positions: [] };
      out.push(pos);
    }
    pos.positions = items;
    pos.positionsClauseId = c.id;

    // Подчинённые должности, которые не являются руководителями подразделений, — самостоятельные узлы.
    for (const [i, item] of items.entries()) {
      if (resolveHolders(item, out, { strict: true }).length) continue;
      if (!/^(директор|руководител|начальник|заместител)/iu.test(item)) continue;
      if (out.some((u) => u.kind === 'position' && stemRegex(u.name)?.test(norm(item)))) continue;
      const child = children[i];
      out.push({
        key: unitKey(item),
        name: item,
        kind: 'position',
        side: c.side,
        docName: c.docName,
        clauseId: child?.id ?? c.id,
        quote: child?.text.trim() ?? item,
        positions: []
      });
    }
  }
  return out;
}

/**
 * Кому принадлежит формулировка: ищет подразделения по аббревиатуре и по основам наименования.
 * strict — только явные совпадения, без «всех департаментов».
 */
export function resolveHolders(text: string, units: UnitDef[], opts: { strict?: boolean } = {}): UnitDef[] {
  const hits = units.filter((u) => {
    if (u.abbr && new RegExp(`(?<![\\p{L}])${u.abbr}(?![\\p{L}])`, 'u').test(text)) return true;
    const core = u.kind === 'unit' ? u.name.split(/\s+/).slice(1).join(' ') : u.name;
    return stemRegex(core)?.test(norm(text)) ?? false;
  });
  if (hits.length || opts.strict) return hits;
  if (/директор\p{L}*\s+департамент/iu.test(text)) return units.filter((u) => u.kind === 'unit');
  return [];
}

/**
 * Носители функции, описанной пунктом: явная пометка «(ДИТААД)» в самом пункте,
 * иначе ближайший предок-заголовок роли («5.3. Директор направления …:»),
 * иначе ненумерованный заголовок («Главный аудитор:»). Пусто — функция блока в целом.
 */
export function holdersOf(c: ParsedClause, byId: Map<string, ParsedClause>, units: UnitDef[]): UnitDef[] {
  const tag = c.text.match(/\(([А-ЯЁA-Z]{2,12})\)\s*[.;]?\s*$/u);
  if (tag) {
    const u = units.find((x) => x.abbr === tag[1]);
    if (u) return [u];
  }
  if (ROLE_START.test(c.text) && c.text.length < 400) {
    if (/работник\p{L}*\s+БВА|БВА\s+в\s+своей/iu.test(c.text.slice(0, 80))) return [];
    const own = resolveHolders(c.text.slice(0, 120), units);
    if (own.length) return own;
  }
  let p = c.parentId ? byId.get(c.parentId) : undefined;
  while (p) {
    if (ROLE_START.test(p.text)) {
      if (/работник\p{L}*\s+БВА|БВА\s+в\s+своей/iu.test(p.text.slice(0, 80))) return [];
      const hs = resolveHolders(p.text.slice(0, 160), units);
      if (hs.length) return hs;
    }
    p = p.parentId ? byId.get(p.parentId) : undefined;
  }
  if (c.roleHint) return resolveHolders(c.roleHint, units, { strict: true });
  return [];
}

export const evidenceOf = (u: UnitDef, docName: string): Evidence => ({
  side: u.side,
  docName,
  clauseId: u.clauseId,
  quote: u.quote,
  verified: true
});

/** Должности без привязки к аббревиатуре подразделения — чтобы «Директор проектов ДНМ» = «Директор проектов». */
export function normPosition(p: string, u: UnitDef): string {
  let s = p;
  if (u.abbr) s = s.replace(new RegExp(`\\s*${u.abbr}\\b`, 'u'), '');
  return norm(s);
}
