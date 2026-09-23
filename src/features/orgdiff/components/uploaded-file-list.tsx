'use client';

import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { fileKey, formatFileSize, getFileKind } from '../utils/file-kind';

interface UploadedFileListProps {
  files: File[];
  disabled?: boolean;
  onRemove: (key: string) => void;
}

export function UploadedFileList({ files, disabled, onRemove }: UploadedFileListProps) {
  if (files.length === 0) {
    return <p className='text-muted-foreground px-1 text-xs'>Файлы не выбраны</p>;
  }

  return (
    <ul className='flex flex-col gap-2' aria-label='Выбранные файлы'>
      {files.map((file) => {
        const key = fileKey(file);
        const kind = getFileKind(file.name);
        const KindIcon = Icons[kind.icon];
        return (
          <li key={key} className='bg-muted/40 flex items-center gap-3 rounded-lg border px-3 py-2'>
            <KindIcon className='text-muted-foreground size-5 shrink-0' aria-hidden='true' />
            <div className='min-w-0 flex-1'>
              <p className='truncate text-sm font-medium' title={file.name}>
                {file.name}
              </p>
              <p className='text-muted-foreground text-xs'>{formatFileSize(file.size)}</p>
            </div>
            <Badge variant='outline'>{kind.label}</Badge>
            <Button
              type='button'
              variant='ghost'
              size='icon-sm'
              disabled={disabled}
              onClick={() => onRemove(key)}
              aria-label={`Убрать ${file.name}`}
            >
              <Icons.close />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
