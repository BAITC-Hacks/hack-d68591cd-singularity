'use client';

import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { downloadReport, type ReportFormat } from '../../api/service';
import type { FindingReviews } from '../../hooks/use-finding-reviews';
import type { AnalysisResult } from '../../types';

interface ConclusionActionsProps {
  result: AnalysisResult;
  reviews: FindingReviews;
  markdown: string;
}

export function ConclusionActions({ result, reviews, markdown }: ConclusionActionsProps) {
  const download = useMutation({
    mutationFn: async (format: ReportFormat) => {
      const blob = await downloadReport(result, reviews, format);
      const suffix = result.meta.resultId ? `-${result.meta.resultId}` : '';
      saveBlob(blob, `orgdiff-zaklyuchenie${suffix}.${format}`);
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
    <div className='flex flex-col items-start gap-1 sm:items-end'>
      <div className='flex flex-wrap gap-2 sm:justify-end'>
        <Button variant='outline' size='sm' onClick={copy}>
          <Icons.forms />
          Скопировать
        </Button>
        {(['md', 'docx'] as const).map((format) => (
          <Button
            key={format}
            variant={format === 'docx' ? 'default' : 'outline'}
            size='sm'
            disabled={download.isPending}
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
        В файле учтены решения по выводам: отклонённые — в приложении
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
