/** Нормализация для сравнения формулировок: регистр, ё/е, пунктуация, пробелы. */
export const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"“”„'`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const STOP = new Set([
  'и', 'в', 'на', 'по', 'с', 'для', 'от', 'до', 'о', 'об', 'из', 'за', 'к', 'не', 'или', 'а', 'то', 'при',
  'как', 'что', 'это', 'также', 'их', 'его', 'ее', 'том', 'числе', 'иных', 'иные', 'в т ч', 'общества', 'бва'
]);

/** Значимые основы слов (грубый стемминг обрезкой — для блокировки кандидатов, не для выводов). */
export function stems(s: string): Set<string> {
  return new Set(
    norm(s)
      .split(' ')
      .filter((w) => w.length > 3 && !STOP.has(w))
      .map((w) => w.slice(0, Math.max(4, w.length - 2)))
  );
}

/** Сходство по Жаккару над основами слов. */
export function jaccard(a: string, b: string): number {
  const ta = stems(a);
  const tb = stems(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/**
 * Регулярка «по основам» для наименований в разных падежах:
 * «Директор направления внутреннего аудита» ловит и «Директору направления внутреннего аудита».
 */
export function stemRegex(phrase: string): RegExp | null {
  const words = norm(phrase).split(' ').filter(Boolean);
  if (!words.length) return null;
  const parts = words.map((w) => {
    const stem = w.length <= 4 ? w : w.slice(0, Math.max(4, w.length - 2));
    return stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\p{L}*';
  });
  return new RegExp(parts.join('\\s+'), 'iu');
}

/** Цитата действительно есть в тексте пункта (с точностью до нормализации). */
export function quoteInText(quote: string, text: string): boolean {
  const q = norm(quote);
  return q.length > 0 && norm(text).includes(q);
}

export const clip = (s: string, n = 220) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s);

/** Параллельный map с ограничением числа одновременных задач. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = Array.from({ length: items.length });
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
