// ============================================================
// OrgDiff Service — Data Access Layer
// ============================================================
// Единственное место, где интерфейс ходит за данными.
//   POST /api/analyze          multipart before[] / after[] → { jobId }
//   GET  /api/analyze/{jobId}  → AnalysisJob (trace + result)
// NEXT_PUBLIC_USE_MOCK=1 → тот же протокол, но задача проигрывает mock.json
// (демо не зависит от LLM).
// ============================================================

import { ANALYZE_ENDPOINT, MOCK_STEP_MS, SAMPLE_SET, USE_MOCK } from '../constants';
import type { AnalysisJob, AnalysisResult, DocSide } from '../types';

export interface AnalyzePayload {
  before: File[];
  after: File[];
}

const MOCK_JOB_PREFIX = 'mock-';

export async function startAnalysis(payload: AnalyzePayload): Promise<string> {
  if (USE_MOCK) return `${MOCK_JOB_PREFIX}${Date.now()}`;

  const body = new FormData();
  payload.before.forEach((file) => body.append('before[]', file, file.name));
  payload.after.forEach((file) => body.append('after[]', file, file.name));

  // Без Content-Type: браузер сам проставит multipart boundary
  const res = await fetch(ANALYZE_ENDPOINT, { method: 'POST', body });
  const data = await readJson(res);
  if (!isRecord(data) || typeof data.jobId !== 'string') {
    throw new Error('Пайплайн не вернул идентификатор задачи');
  }
  return data.jobId;
}

export async function getAnalysisJob(jobId: string): Promise<AnalysisJob> {
  const raw = jobId.startsWith(MOCK_JOB_PREFIX)
    ? await getMockJob(jobId)
    : await readJson(await fetch(`${ANALYZE_ENDPOINT}/${encodeURIComponent(jobId)}`));

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
  const res = await fetch(url);
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

  const trace = result.trace
    .slice(0, doneSteps + 1)
    .map((step, index) =>
      index < doneSteps ? step : { ...step, status: 'running' as const, detail: undefined }
    );
  return { id: jobId, status: 'running', trace };
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
