export type DiffKind = 'same' | 'removed' | 'added';

export interface DiffToken {
  kind: DiffKind;
  text: string;
}

export interface WordDiff {
  before: DiffToken[];
  after: DiffToken[];
  /** Тексты совпадают до пробелов и регистра */
  identical: boolean;
  /** Доля общих слов 0..1 (коэффициент Дайса по LCS) */
  similarity: number;
}

/** Ниже — тексты про разное: подсветка закрасила бы всё и ничего бы не объяснила */
export const MIN_DIFF_SIMILARITY = 0.4;

/** Длиннее — не сравниваем (LCS квадратичный), показываем тексты как есть */
const MAX_TOKENS = 600;

/**
 * Пословное сравнение двух цитат (LCS по словам).
 * Слова сравниваются без учёта регистра и пунктуации по краям,
 * но в результате остаётся исходное написание вместе с пробелами.
 */
export function diffWords(beforeText: string, afterText: string): WordDiff {
  const before = tokenize(beforeText);
  const after = tokenize(afterText);

  if (before.length > MAX_TOKENS || after.length > MAX_TOKENS) {
    return {
      before: [{ kind: 'same', text: beforeText }],
      after: [{ kind: 'same', text: afterText }],
      identical: normalize(beforeText) === normalize(afterText),
      similarity: 0
    };
  }

  const table = lcsTable(before.map(wordKey), after.map(wordKey));
  const beforeTokens: DiffToken[] = [];
  const afterTokens: DiffToken[] = [];

  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (wordKey(before[i]) === wordKey(after[j])) {
      beforeTokens.push({ kind: 'same', text: before[i] });
      afterTokens.push({ kind: 'same', text: after[j] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      beforeTokens.push({ kind: 'removed', text: before[i] });
      i += 1;
    } else {
      afterTokens.push({ kind: 'added', text: after[j] });
      j += 1;
    }
  }
  before.slice(i).forEach((text) => beforeTokens.push({ kind: 'removed', text }));
  after.slice(j).forEach((text) => afterTokens.push({ kind: 'added', text }));

  const total = before.length + after.length;
  return {
    before: mergeTokens(beforeTokens),
    after: mergeTokens(afterTokens),
    identical: !beforeTokens.some(isChange) && !afterTokens.some(isChange),
    similarity: total === 0 ? 1 : (2 * table[0][0]) / total
  };
}

/** Слова вместе с последующими пробелами — чтобы склеить текст обратно без потерь */
function tokenize(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [];
}

function wordKey(token: string): string {
  return token
    .trim()
    .toLowerCase()
    .replace(/^[«"'(]+|[»"'),.;:!?]+$/g, '');
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function isChange(token: DiffToken): boolean {
  return token.kind !== 'same' && wordKey(token.text) !== '';
}

/** table[i][j] — длина LCS суффиксов a[i:] и b[j:] */
function lcsTable(a: string[], b: string[]): number[][] {
  const table = Array.from({ length: a.length + 1 }, () =>
    Array.from({ length: b.length + 1 }, () => 0)
  );
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] =
        a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  return table;
}

/** Соседние токены одного вида склеиваем, чтобы подсветка шла сплошными фрагментами */
function mergeTokens(tokens: DiffToken[]): DiffToken[] {
  return tokens.reduce<DiffToken[]>((merged, token) => {
    const last = merged.at(-1);
    if (last && last.kind === token.kind) {
      return [...merged.slice(0, -1), { kind: last.kind, text: last.text + token.text }];
    }
    return [...merged, token];
  }, []);
}
