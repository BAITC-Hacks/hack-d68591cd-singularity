import { createHash } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import OpenAI from 'openai';

export const MODEL = process.env.OPENAI_MODEL || 'gpt-6-sol';
export const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-large';

/**
 * Кэш ответов модели на диске (data/cache). Закоммичен в репозиторий: демо на тестовом
 * комплекте воспроизводится мгновенно и одинаково у любого, кто клонировал проект.
 */
const CACHE_DIR = path.join(process.cwd(), 'data', 'cache');

let client: OpenAI | null = null;
const openai = () => {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY не задан — см. .env');
  client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 2, timeout: 180_000 });
  return client;
};

const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 24);

/** Файлы кэша, к которым обращался текущий процесс, — для чистки устаревших (bun run eval --prune). */
export const usedCacheFiles = new Set<string>();

async function cached<T>(kind: string, key: unknown, produce: () => Promise<T>): Promise<{ value: T; hit: boolean }> {
  const file = path.join(CACHE_DIR, kind, `${hash(key)}.json`);
  usedCacheFiles.add(file);
  try {
    return { value: JSON.parse(await readFile(file, 'utf-8')) as T, hit: true };
  } catch {
    const value = await produce();
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(value));
    return { value, hit: false };
  }
}

/** Статистика вызовов для ленты шагов агента. */
export const llmStats = { calls: 0, cacheHits: 0 };

/** Строгие JSON-схемы для structured outputs: все поля обязательны, лишние запрещены. */
export const S = {
  str: (description?: string) => ({ type: 'string', ...(description ? { description } : {}) }),
  num: (description?: string) => ({ type: 'number', ...(description ? { description } : {}) }),
  enum: (...values: string[]) => ({ type: 'string', enum: values }),
  arr: (items: object) => ({ type: 'array', items }),
  obj: (properties: Record<string, object>) => ({
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties
  })
};

const SYSTEM = [
  'Ты — аналитик организационного проектирования и внутреннего контроля. Анализируешь нормативные',
  'документы организации (положения, оргструктуры, должностные инструкции) на русском языке.',
  'Правила: опирайся ТОЛЬКО на предоставленный текст; не придумывай пункты, подразделения и факты;',
  'цитаты копируй дословно из текста пункта; ссылайся только на переданные номера пунктов;',
  'если данных недостаточно — так и скажи и понижай уверенность. Отвечай по-русски.'
].join(' ');

/** Вызов модели со structured output; ответ кэшируется по модели, промпту и схеме. */
export async function llmJson<T>(
  name: string,
  schema: object,
  prompt: string,
  opts: { effort?: 'low' | 'medium' | 'high' } = {}
): Promise<T> {
  const effort = opts.effort ?? 'low';
  const { value, hit } = await cached('llm', { MODEL, name, schema, prompt, effort }, async () => {
    const res = await openai().responses.create({
      model: MODEL,
      instructions: SYSTEM,
      input: prompt,
      reasoning: { effort },
      text: { format: { type: 'json_schema', name, schema: schema as Record<string, unknown>, strict: true } }
    });
    return JSON.parse(res.output_text) as T;
  });
  llmStats.calls++;
  if (hit) llmStats.cacheHits++;
  return value;
}

/** Размерность урезана до 512: для отбора кандидатов хватает, а кэш остаётся компактным для git. */
const EMBEDDING_DIMS = 512;

/** Эмбеддинги пачкой; кэш по модели и набору текстов. */
export async function embed(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const { value } = await cached('emb', { EMBEDDING_MODEL, EMBEDDING_DIMS, texts }, async () => {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 256) {
      const res = await openai().embeddings.create({
        model: EMBEDDING_MODEL,
        input: texts.slice(i, i + 256),
        dimensions: EMBEDDING_DIMS
      });
      out.push(...res.data.map((d) => d.embedding.map((x) => Math.round(x * 1e4) / 1e4)));
    }
    return out;
  });
  return value;
}
