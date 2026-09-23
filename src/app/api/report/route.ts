import { reportDocx, reportMarkdown } from '@/features/orgdiff/lib/report';
import type { FindingReview, ReportRequest } from '@/features/orgdiff/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const isReview = (v: unknown): v is FindingReview => v === 'confirmed' || v === 'rejected';

/**
 * Итоговое заключение файлом без состояния сервера: интерфейс присылает результат анализа
 * и решения сотрудника. ?format=docx (по умолчанию) или ?format=md.
 */
export async function POST(req: Request) {
  let body: ReportRequest;
  try {
    body = (await req.json()) as ReportRequest;
  } catch {
    return Response.json({ error: 'Ожидается JSON: { result, reviews }' }, { status: 400 });
  }
  const r = body?.result;
  if (!r || !Array.isArray(r.findings) || !Array.isArray(r.units) || !r.conclusion || !r.stats || !r.meta) {
    return Response.json({ error: 'Некорректный результат анализа' }, { status: 400 });
  }
  const reviews = Object.fromEntries(Object.entries(body.reviews ?? {}).filter(([, v]) => isReview(v)));

  const md = new URL(req.url).searchParams.get('format') === 'md';
  const name = `orgdiff-zaklyuchenie${r.meta.resultId ? `-${r.meta.resultId}` : ''}.${md ? 'md' : 'docx'}`;
  const payload = md ? reportMarkdown(r, reviews) : new Uint8Array(await reportDocx(r, reviews));
  return new Response(payload, {
    headers: {
      'Content-Type': md
        ? 'text/markdown; charset=utf-8'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${name}"`
    }
  });
}
