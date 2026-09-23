import { randomUUID } from 'crypto';
import { readFile } from 'fs/promises';
import path from 'path';
import type { AnalysisJob } from '../types';
import { analyze, pendingTrace, type DocInput } from './analyze';

/** Задачи анализа в памяти процесса; globalThis переживает hot reload в dev. */
const g = globalThis as unknown as { __orgdiffJobs?: Map<string, AnalysisJob> };
const jobs = (g.__orgdiffJobs ??= new Map<string, AnalysisJob>());

export function startJob(docs: DocInput[]): string {
  const id = randomUUID().slice(0, 8);
  const job: AnalysisJob = { id, status: 'running', trace: pendingTrace() };
  jobs.set(id, job);
  analyze(docs, (trace) => {
    job.trace = trace;
  })
    .then((result) => {
      job.result = result;
      job.trace = result.trace;
      job.status = 'done';
    })
    .catch((e: unknown) => {
      job.status = 'error';
      job.error = e instanceof Error ? e.message : String(e);
    });
  return id;
}

export const getJob = (id: string) => jobs.get(id);

/** Тестовый комплект организатора: Положение о внутреннем аудите, ред. 8 (до) и ред. 9 (после). */
export const DEMO_FILES = [
  { side: 'before', name: 'before_polozhenie_red8.docx' },
  { side: 'after', name: 'after_polozhenie_red9.docx' }
] as const;

export async function demoDocs(): Promise<DocInput[]> {
  return Promise.all(
    DEMO_FILES.map(async (f) => ({
      side: f.side,
      name: f.name,
      buffer: await readFile(path.join(process.cwd(), 'data', f.name))
    }))
  );
}
