'use client';

import { useEffect } from 'react';

/**
 * Последний рубеж: приложение не отрисовалось целиком. Стили могут не загрузиться,
 * поэтому разметка простая и с инлайн-стилями — главное, чтобы был понятный текст.
 */
export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[orgdiff] Критическая ошибка приложения', error);
  }, [error]);

  return (
    <html lang='ru'>
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          display: 'grid',
          placeItems: 'center',
          minHeight: '100vh',
          margin: 0,
          padding: 16,
          textAlign: 'center'
        }}
      >
        <main style={{ maxWidth: 480 }}>
          <h1 style={{ fontSize: 22 }}>Приложение не загрузилось</h1>
          <p>Обновите страницу. Если ошибка повторится, перезапустите приложение (bun run dev).</p>
          <p style={{ color: '#666', fontSize: 13 }}>Техническая причина: {error.message}</p>
          <button type='button' onClick={reset} style={{ padding: '8px 16px', cursor: 'pointer' }}>
            Попробовать снова
          </button>
        </main>
      </body>
    </html>
  );
}
