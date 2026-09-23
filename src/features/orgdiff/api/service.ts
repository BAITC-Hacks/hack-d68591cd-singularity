// ============================================================
// OrgDiff Service — Data Access Layer
// ============================================================
// Единственное место, где интерфейс ходит за данными.
//   POST /api/analyze          multipart before[] / after[] → { jobId }
//   GET  /api/analyze/{jobId}  → AnalysisJob (trace + result)
// NEXT_PUBLIC_USE_MOCK=1 → тот же протокол, но задача проигрывает mock.json
// (демо не зависит от LLM).
// ============================================================

import {
  ANALYZE_ENDPOINT,
  MOCK_STEP_MS,
  REPORT_ENDPOINT,
  SAMPLE_SET,
  USE_MOCK
} from '../constants';
import type {
  AnalysisJob,
  AnalysisResult,
  DocSide,
  FindingReview,
  ReportRequest,
  TraceStep
} from '../types';

export interface AnalyzePayload {
  before: File[];
  after: File[];
}

const MOCK_JOB_PREFIX = 'mock-';

const NETWORK_ERROR =
  'Нет связи с сервером анализа. Проверьте, что приложение запущено (bun run dev), и повторите.';
const JOB_LOST_ERROR =
  'Сервер потерял задачу анализа (скорее всего, он был перезапущен). Запустите анализ ещё раз.';

export type ReportFormat = 'docx' | 'md';

export async function startAnalysis(payload: AnalyzePayload): Promise<string> {
  if (USE_MOCK) return `${MOCK_JOB_PREFIX}${Date.now()}`;

  const body = new FormData();
  payload.before.forEach((file) => body.append('before[]', file, file.name));
  payload.after.forEach((file) => body.append('after[]', file, file.name));

  // Без Content-Type: браузер сам проставит multipart boundary
  const res = await request(ANALYZE_ENDPOINT, { method: 'POST', body });
  const data = await readJson(res);
  if (!isRecord(data) || typeof data.jobId !== 'string') {
    throw new Error('Пайплайн не вернул идентификатор задачи');
  }
  return data.jobId;
}

export async function getAnalysisJob(jobId: string): Promise<AnalysisJob> {
  const raw = jobId.startsWith(MOCK_JOB_PREFIX) ? await getMockJob(jobId) : await fetchJob(jobId);

  if (!isRecord(raw) || typeof raw.status !== 'string' || !Array.isArray(raw.trace)) {
    console.error('[orgdiff] Некорректный ответ задачи', raw);
    throw new Error('Пайплайн вернул ответ в неожиданном формате');
  }
  const job = raw as unknown as AnalysisJob;
  return job.status === 'done' && job.result ? { ...job, result: sanitizeResult(job.result) } : job;
}

/** Тестовый комплект (ред. 8 → ред. 9) как настоящие File — уходит в тот же POST */
export async function loadSampleSet(): Promise<Record<DocSide, File[]>> {
  const [before, after] = await Promise.all([
    Promise.all(SAMPLE_SET.before.map(fetchSampleFile)),
    Promise.all(SAMPLE_SET.after.map(fetchSampleFile))
  ]);
  return { before, after };
}

async function fetchSampleFile({ url, name }: { url: string; name: string }): Promise<File> {
  const res = await request(url);
  if (!res.ok) {
    throw new Error(`Не удалось загрузить тестовый файл ${name} (${res.status})`);
  }
  const blob = await res.blob();
  return new File([blob], name, { type: blob.type });
}

/** Мок без состояния: время старта зашито в jobId, шаги trace открываются по таймеру */
async function getMockJob(jobId: string): Promise<AnalysisJob> {
  const { default: mock } = await import('../mock.json');
  const result = mock as unknown as AnalysisResult;
  const startedAt = Number(jobId.slice(MOCK_JOB_PREFIX.length));
  const doneSteps = Math.floor((Date.now() - startedAt) / MOCK_STEP_MS);

  if (doneSteps >= result.trace.length) {
    return { id: jobId, status: 'done', trace: result.trace, result: structuredClone(result) };
  }

  // Как живой API: весь план сразу, будущие шаги — pending
  const trace = result.trace.map((step, index): TraceStep => {
    if (index < doneSteps) return step;
    const status = index === doneSteps ? 'running' : 'pending';
    return { ...step, status, detail: undefined, finishedAt: undefined };
  });
  return { id: jobId, status: 'running', trace };
}

async function fetchJob(jobId: string): Promise<unknown> {
  const res = await request(`${ANALYZE_ENDPOINT}/${encodeURIComponent(jobId)}`);
  if (res.status === 404) throw new Error(JOB_LOST_ERROR);
  return readJson(res);
}

/** fetch с понятной ошибкой вместо «Failed to fetch», когда сервер недоступен */
async function request(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    console.error('[orgdiff] Сетевая ошибка', url, error);
    throw new Error(NETWORK_ERROR, { cause: error });
  }
}

async function readJson(res: Response): Promise<unknown> {
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // тело не JSON — сообщим статус ниже
  }
  if (!res.ok) {
    const message = isRecord(data) && typeof data.error === 'string' ? data.error : null;
    throw new Error(message ?? `Пайплайн анализа вернул ошибку ${res.status}`);
  }
  return data;
}

/**
 * Граница системы: не доверяем ответу пайплайна.
 * Находки без источника не показываем (ограничение 9 ТЗ) — только логируем.
 */
function sanitizeResult(result: AnalysisResult): AnalysisResult {
  const shapeOk =
    Array.isArray(result.units) &&
    Array.isArray(result.flows) &&
    Array.isArray(result.functions) &&
    Array.isArray(result.matches) &&
    Array.isArray(result.findings) &&
    isRecord(result.conclusion) &&
    isRecord(result.stats);
  if (!shapeOk) {
    console.error('[orgdiff] Некорректный результат анализа', result);
    throw new Error('Пайплайн вернул результат в неожиданном формате');
  }

  const findings = result.findings.filter((finding) => {
    const hasEvidence = Array.isArray(finding.evidence) && finding.evidence.length > 0;
    if (!hasEvidence) {
      console.warn('[orgdiff] Находка без источника скрыта', finding.id, finding.title);
    }
    return hasEvidence;
  });

  return { ...result, findings };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Файл заключения без состояния сервера: POST /api/report?format=… с результатом
 * и решениями сотрудника. Работает и для мока, и после перезапуска сервера.
 */
export async function downloadReport(
  result: AnalysisResult,
  reviews: Readonly<Record<string, FindingReview>>,
  format: ReportFormat
): Promise<Blob> {
  const body: ReportRequest = { result: reportPayload(result), reviews };
  const res = await request(`${REPORT_ENDPOINT}?format=${format}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const data: unknown = await res.json().catch(() => null);
    const message = isRecord(data) && typeof data.error === 'string' ? data.error : null;
    throw new Error(message ?? `Не удалось сформировать файл (${res.status})`);
  }
  return res.blob();
}

/**
 * Генератору отчёта (lib/report.ts) нужны только заключение, выводы, подразделения,
 * документы, статистика и meta. Тексты пунктов, функции и сопоставления — ~1,4 МБ —
 * не отправляем; если отчёт начнёт их использовать, убрать это сокращение.
 */
function reportPayload(result: AnalysisResult): AnalysisResult {
  return { ...result, clauses: [], functions: [], matches: [], flows: [], trace: [] };
}
