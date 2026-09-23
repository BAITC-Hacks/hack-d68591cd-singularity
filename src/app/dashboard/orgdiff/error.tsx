'use client';

import { useEffect } from 'react';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';

/** Ошибка страницы анализа: понятный текст вместо белого экрана */
export default function OrgdiffError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[orgdiff] Ошибка страницы анализа', error);
  }, [error]);

  return (
    <div
      role='alert'
      className='flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center'
    >
      <Icons.alertCircle className='text-destructive size-10' aria-hidden='true' />
      <div className='max-w-lg'>
        <h2 className='text-xl font-semibold'>Страница анализа не загрузилась</h2>
        <p className='text-muted-foreground mt-2 text-sm'>
          Попробуйте ещё раз. Если ошибка повторится, откройте страницу заново и запустите анализ
          тестового комплекта.
        </p>
        <p className='text-muted-foreground mt-2 text-xs'>Техническая причина: {error.message}</p>
      </div>
      <div className='flex gap-2'>
        <Button onClick={reset}>Попробовать снова</Button>
        <Button variant='outline' onClick={() => window.location.assign('/dashboard/orgdiff')}>
          Начать заново
        </Button>
      </div>
    </div>
  );
}
