'use client';

import { useCallback, useSyncExternalStore } from 'react';

/** Решение сотрудника по выводу — локально, на бэкенд не уходит */
export type FindingReview = 'confirmed' | 'rejected';
export type FindingReviews = Readonly<Record<string, FindingReview>>;

const STORAGE_PREFIX = 'orgdiff:reviews:';
const EMPTY: FindingReviews = Object.freeze({});

const memory = new Map<string, FindingReviews>();
const listeners = new Set<() => void>();

/**
 * Решения по выводам конкретного результата (ключ — meta.generatedAt).
 * Переживают переключение вкладок и перезагрузку; без localStorage — только в памяти.
 */
export function useFindingReviews(resultKey: string) {
  const reviews = useSyncExternalStore(
    subscribe,
    () => readReviews(resultKey),
    () => EMPTY
  );

  const setReview = useCallback(
    (findingId: string, review: FindingReview | null) => {
      const current = readReviews(resultKey);
      const { [findingId]: _previous, ...rest } = current;
      writeReviews(resultKey, review ? { ...rest, [findingId]: review } : rest);
    },
    [resultKey]
  );

  return { reviews, setReview };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function readReviews(key: string): FindingReviews {
  const cached = memory.get(key);
  if (cached) return cached;
  const loaded = loadFromStorage(key);
  memory.set(key, loaded);
  return loaded;
}

function writeReviews(key: string, reviews: FindingReviews): void {
  memory.set(key, reviews);
  try {
    window.localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(reviews));
  } catch (error) {
    console.warn('[orgdiff] Решения по выводам не сохранены в localStorage', error);
  }
  listeners.forEach((listener) => listener());
}

function loadFromStorage(key: string): FindingReviews {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return EMPTY;
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, FindingReview] =>
          entry[1] === 'confirmed' || entry[1] === 'rejected'
      )
    );
  } catch {
    return EMPTY;
  }
}
