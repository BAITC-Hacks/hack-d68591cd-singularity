'use client';

import { useDropzone, type FileRejection } from 'react-dropzone';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  ACCEPTED_EXTENSIONS_LABEL,
  ACCEPTED_FILES,
  MAX_FILES_PER_SIDE,
  MAX_FILE_SIZE,
  SIDE_LABELS
} from '../constants';
import type { DocSide } from '../types';
import { fileKey, formatFileSize, pluralizeFiles } from '../utils/file-kind';
import { UploadedFileList } from './uploaded-file-list';

interface UploadDropzoneProps {
  side: DocSide;
  files: File[];
  disabled?: boolean;
  onFilesChange: (files: File[]) => void;
}

export function UploadDropzone({ side, files, disabled, onFilesChange }: UploadDropzoneProps) {
  const labels = SIDE_LABELS[side];

  const onDrop = (accepted: File[], rejected: FileRejection[]) => {
    rejected.forEach(notifyRejection);

    const empty = accepted.filter((file) => file.size === 0);
    empty.forEach((file) => toast.error(`${file.name}: файл пустой — в нём нечего анализировать`));

    const known = new Set(files.map(fileKey));
    const duplicates = accepted.filter((file) => file.size > 0 && known.has(fileKey(file)));
    if (duplicates.length > 0) {
      toast.info(`Уже добавлено: ${duplicates.map((file) => file.name).join(', ')}`);
    }
    const fresh = accepted.filter((file) => file.size > 0 && !known.has(fileKey(file)));
    const room = MAX_FILES_PER_SIDE - files.length;

    if (fresh.length > room) {
      toast.error(`${labels.title}: не больше ${MAX_FILES_PER_SIDE} файлов`);
    }
    if (fresh.length > 0 && room > 0) {
      onFilesChange([...files, ...fresh.slice(0, room)]);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_FILES,
    maxSize: MAX_FILE_SIZE,
    multiple: true,
    disabled
  });

  return (
    <Card className='min-w-0 flex-1'>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          {labels.title}
          <span className='text-muted-foreground text-xs font-normal'>
            {files.length > 0 ? pluralizeFiles(files.length) : ''}
          </span>
        </CardTitle>
        <CardDescription>{labels.description}</CardDescription>
      </CardHeader>
      <CardContent className='flex flex-col gap-4'>
        <div
          {...getRootProps()}
          className={cn(
            'border-muted-foreground/25 hover:bg-muted/30 grid h-36 cursor-pointer place-items-center rounded-lg border-2 border-dashed px-4 text-center transition',
            'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-hidden',
            isDragActive && 'border-primary bg-primary/5',
            disabled && 'pointer-events-none opacity-60'
          )}
        >
          <input {...getInputProps()} aria-label={`Загрузить файлы: ${labels.title}`} />
          <div className='flex flex-col items-center gap-2'>
            <Icons.upload className='text-muted-foreground size-6' aria-hidden='true' />
            <p className='text-sm font-medium'>
              {isDragActive ? 'Отпустите файлы здесь' : 'Перетащите файлы или нажмите для выбора'}
            </p>
            <p className='text-muted-foreground text-xs'>
              {ACCEPTED_EXTENSIONS_LABEL} · до {formatFileSize(MAX_FILE_SIZE)} каждый · можно
              несколько
            </p>
          </div>
        </div>
        <UploadedFileList
          files={files}
          disabled={disabled}
          onRemove={(key) => onFilesChange(files.filter((file) => fileKey(file) !== key))}
        />
      </CardContent>
    </Card>
  );
}

function notifyRejection({ file, errors }: FileRejection) {
  const code = errors[0]?.code;
  if (code === 'file-invalid-type') {
    toast.error(`${file.name}: неподдерживаемый формат. Нужен ${ACCEPTED_EXTENSIONS_LABEL}`);
  } else if (code === 'file-too-large') {
    toast.error(`${file.name}: файл больше ${formatFileSize(MAX_FILE_SIZE)}`);
  } else {
    toast.error(`${file.name}: файл не принят`);
  }
}
