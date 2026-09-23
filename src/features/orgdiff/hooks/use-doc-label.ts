'use client';

import { useCallback } from 'react';
import { useAnalysisResult } from '../api/queries';
import type { DocSide } from '../types';

const SIDE_FALLBACK: Record<DocSide, string> = { before: 'до', after: 'после' };

/**
 * Короткая метка документа для ссылок на пункты: «ред. 9».
 * Нет short (или документов на стороне несколько) — «до» / «после».
 */
export function useDocLabel(): (side: DocSide, docName?: string) => string {
  const documents = useAnalysisResult()?.documents;

  return useCallback(
    (side, docName) => {
      const sideDocs = (documents ?? []).filter((doc) => doc.side === side);
      const doc =
        sideDocs.find((item) => item.name === docName) ??
        (sideDocs.length === 1 ? sideDocs[0] : undefined);
      return doc?.short ?? SIDE_FALLBACK[side];
    },
    [documents]
  );
}
