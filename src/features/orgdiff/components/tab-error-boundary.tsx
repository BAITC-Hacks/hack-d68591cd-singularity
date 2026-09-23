'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';

interface TabErrorBoundaryProps {
  /** Название вкладки для сообщения */
  label: string;
  children: ReactNode;
}

interface TabErrorBoundaryState {
  error: Error | null;
}

/**
 * Ошибка отрисовки одной вкладки не должна ронять страницу:
 * остальные вкладки и результат анализа остаются доступны.
 */
export class TabErrorBoundary extends Component<TabErrorBoundaryProps, TabErrorBoundaryState> {
  state: TabErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): TabErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      `[orgdiff] Вкладка «${this.props.label}» не отрисовалась`,
      error,
      info.componentStack
    );
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        role='alert'
        className='border-destructive/40 flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center'
      >
        <Icons.alertCircle className='text-destructive size-8' aria-hidden='true' />
        <div>
          <p className='font-medium'>Не удалось показать вкладку «{this.props.label}»</p>
          <p className='text-muted-foreground mt-1 text-sm'>
            Результат анализа сохранён — остальные вкладки работают. Техническая причина:{' '}
            {this.state.error.message}
          </p>
        </div>
        <Button variant='outline' size='sm' onClick={() => this.setState({ error: null })}>
          Попробовать снова
        </Button>
      </div>
    );
  }
}
