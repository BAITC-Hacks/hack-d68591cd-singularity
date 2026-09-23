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
  clauseId: string;
  quote: string;
  positions: string[];
  positionsClauseId?: string;
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

const childrenOf = (clauses: ParsedClause[], id: string) => clauses.filter((c) => c.parentId === id);

/**
 * Состав подразделений и самостоятельных должностей по разделу «Структура» (must have 1).
 * Сделано правилом, а не LLM: состав — фундамент всех выводов и должен быть воспроизводимым.
 * Если правило ничего не нашло (другой формат документа), состав извлекает LLM — см. analyze.ts.
 */
export function extractStructure(clauses: ParsedClause[]): UnitDef[] {
  const out: UnitDef[] = [];
  const anchor = clauses.find((c) => /состоит из следующих (?:структурных )?подразделений/iu.test(c.text));
  if (anchor) {
    for (const c of childrenOf(clauses, anchor.id)) {
      const m = c.text.trim().match(UNIT_RE);
      if (!m) continue;
      out.push({
        key: unitKey(m[1], m[2]),
        name: m[1].trim(),
        abbr: m[2],
        kind: 'unit',
        side: c.side,
        clauseId: c.id,
        quote: c.text.trim(),
        positions: []
      });
    }
  }

  // Линии подчинённости: владелец перечня + должности буквенными подпунктами.
  for (const c of clauses) {
    const m = c.text.match(SUBORD_RE);
    if (!m) continue;
    const owner = toNominative(m[1]);
    const items = childrenOf(clauses, c.id).map((k) => k.text.trim().replace(/[.;]$/, ''));
    if (!items.length) continue;

    const ownerUnit = resolveHolders(owner, out, { strict: true })[0];
    if (ownerUnit) {
      ownerUnit.positions = items;
      ownerUnit.positionsClauseId = c.id;
      continue;
    }

    // Владелец — должность вне подразделений (Главный аудитор, Директор направления …).
    let pos = out.find((u) => u.kind === 'position' && stemRegex(u.name)?.test(norm(owner)));
    if (!pos) {
      pos = { key: unitKey(owner), name: owner, kind: 'position', side: c.side, clauseId: c.id, quote: c.text, positions: [] };
      out.push(pos);
    }
    pos.positions = items;
    pos.positionsClauseId = c.id;

    // Подчинённые должности, которые не являются руководителями подразделений, — самостоятельные узлы.
    for (const [i, item] of items.entries()) {
      if (resolveHolders(item, out, { strict: true }).length) continue;
      if (!/^(директор|руководител|начальник|заместител)/iu.test(item)) continue;
      if (out.some((u) => u.kind === 'position' && stemRegex(u.name)?.test(norm(item)))) continue;
      const child = childrenOf(clauses, c.id)[i];
      out.push({
        key: unitKey(item),
        name: item,
        kind: 'position',
        side: c.side,
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
