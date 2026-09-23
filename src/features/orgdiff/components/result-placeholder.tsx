'use client';

import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty';

interface ResultPlaceholderProps {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function ResultPlaceholder({
  title,
  description,
  actionLabel,
  onAction
}: ResultPlaceholderProps) {
  return (
    <Empty className='border'>
      <EmptyHeader>
        <EmptyMedia variant='icon'>
          <Icons.sitemap />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {actionLabel && onAction ? (
        <EmptyContent>
          <Button variant='outline' onClick={onAction}>
            {actionLabel}
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  );
}
