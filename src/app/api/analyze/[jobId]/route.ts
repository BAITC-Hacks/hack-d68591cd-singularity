import { NextResponse } from 'next/server';
import { getJob } from '@/features/orgdiff/lib/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Статус задачи анализа: лента шагов агента и, когда готово, результат. */
export async function GET(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = getJob(jobId);
  if (!job) return NextResponse.json({ error: 'Задача не найдена' }, { status: 404 });
  return NextResponse.json(job);
}
