'use client';

import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { useResultJobId } from '../../api/queries';
import { canDownloadReport, downloadReport, type ReportFormat } from '../../api/service';

interface ConclusionActionsProps {
  markdown: string;
}

export function ConclusionActions({ markdown }: ConclusionActionsProps) {
  const jobId = useResultJobId();
  const canDownload = canDownloadReport(jobId);

  const download = useMutation({
    mutationFn: async (format: ReportFormat) => {
      if (!canDownloadReport(jobId)) throw new Error('Файл доступен только для анализа на сервере');
      const blob = await downloadReport(jobId, format);
      saveBlob(blob, `orgdiff-zaklyuchenie.${format}`);
    },
    onError: (error) => toast.error(`Файл не сформирован: ${error.message}`)
  });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      toast.success('Заключение скопировано (Markdown, с отметками проверки)');
    } catch {
      toast.error('Браузер не дал доступ к буферу обмена');
    }
  };

  return (
    <div className='flex flex-col items-end gap-1'>
      <div className='flex flex-wrap justify-end gap-2'>
        <Button variant='outline' size='sm' onClick={copy}>
          <Icons.forms />
          Скопировать
        </Button>
        {(['md', 'docx'] as const).map((format) => (
          <Button
            key={format}
            variant={format === 'docx' ? 'default' : 'outline'}
            size='sm'
            disabled={!canDownload || download.isPending}
            onClick={() => download.mutate(format)}
          >
            {download.isPending && download.variables === format ? (
              <Icons.spinner className='animate-spin' />
            ) : (
              <Icons.page />
            )}
            Скачать .{format}
          </Button>
        ))}
      </div>
      <p className='text-muted-foreground text-xs'>
        {canDownload
          ? 'Файл формирует сервер; отметки проверки в него пока не попадают — они есть в «Скопировать»'
          : 'Скачивание доступно после анализа на сервере (не в демо-режиме)'}
      </p>
    </div>
  );
}

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
