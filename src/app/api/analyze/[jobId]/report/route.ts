import { getJob } from '@/features/orgdiff/lib/jobs';
import { reportDocx, reportMarkdown } from '@/features/orgdiff/lib/report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Итоговое заключение файлом: ?format=docx (по умолчанию) или ?format=md. */
export async function GET(req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = getJob(jobId);
  if (!job?.result) {
    return Response.json({ error: job ? 'Анализ ещё не завершён' : 'Задача не найдена' }, { status: job ? 409 : 404 });
  }

  const md = new URL(req.url).searchParams.get('format') === 'md';
  const name = `orgdiff-zaklyuchenie-${jobId}.${md ? 'md' : 'docx'}`;
  const body = md ? reportMarkdown(job.result) : new Uint8Array(await reportDocx(job.result));
  return new Response(body, {
    headers: {
      'Content-Type': md
        ? 'text/markdown; charset=utf-8'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${name}"`
    }
  });
}
