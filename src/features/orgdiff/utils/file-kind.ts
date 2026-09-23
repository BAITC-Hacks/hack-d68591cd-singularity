import type { Icons } from '@/components/icons';

export interface FileKind {
  label: string;
  icon: keyof typeof Icons;
}

const KINDS: Record<string, FileKind> = {
  docx: { label: 'Word', icon: 'fileTypeDoc' },
  pdf: { label: 'PDF', icon: 'fileTypePdf' },
  xlsx: { label: 'Excel', icon: 'fileTypeXls' }
};

const UNKNOWN: FileKind = { label: 'Файл', icon: 'page' };

export function getFileKind(fileName: string): FileKind {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  return KINDS[extension] ?? UNKNOWN;
}

/** Один и тот же файл, брошенный дважды, не дублируем */
export function fileKey(file: File): string {
  return `${file.name}:${file.size}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${Number((bytes / (1024 * 1024)).toFixed(1))} МБ`;
}

export function pluralizeFiles(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} файл`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} файла`;
  return `${count} файлов`;
}
