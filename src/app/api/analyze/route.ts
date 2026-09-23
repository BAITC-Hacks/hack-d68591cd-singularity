import { NextResponse } from 'next/server';
import type { DocInput } from '@/features/orgdiff/lib/analyze';
import { demoDocs, startJob } from '@/features/orgdiff/lib/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ACCEPTED = /\.(docx|pdf|xlsx|txt|md|png|jpe?g)$/i;

/**
 * Запуск анализа. multipart: before=файлы «до», after=файлы «после» (можно по нескольку).
 * ?demo=1 — тестовый комплект из data/ без загрузки файлов. Ответ: { jobId }.
 */
export async function POST(req: Request) {
  if (new URL(req.url).searchParams.get('demo')) {
    return NextResponse.json({ jobId: startJob(await demoDocs()) });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Ожидается multipart/form-data с файлами before и after' }, { status: 400 });
  }
  const docs: DocInput[] = [];
  for (const side of ['before', 'after'] as const) {
    for (const f of [...form.getAll(side), ...form.getAll(`${side}[]`)]) {
      if (typeof f === 'string') continue;
      if (!ACCEPTED.test(f.name)) {
        return NextResponse.json({ error: `Неподдерживаемый формат: ${f.name}. Нужны .docx, .pdf, .xlsx, .txt или скан .png/.jpg` }, { status: 400 });
      }
      docs.push({ side, name: f.name, buffer: Buffer.from(await f.arrayBuffer()) });
    }
  }
  if (!docs.some((d) => d.side === 'before') || !docs.some((d) => d.side === 'after')) {
    return NextResponse.json({ error: 'Нужны документы обоих комплектов: «до» и «после»' }, { status: 400 });
  }
  return NextResponse.json({ jobId: startJob(docs) });
}
