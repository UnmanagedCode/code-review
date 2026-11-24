import { useSyncExternalStore } from 'react';

export interface FileFilter { text: string; needsMe: boolean; undecided: boolean }
const EMPTY: FileFilter = { text: '', needsMe: false, undecided: false };

/**
 * The file tree's filter per review, kept outside any component (like `guideOpenFiles.ts`) because a phone unmounts the
 * tree whenever a file is open and the filter must survive that round trip.
 */
const byReview = new Map<string, FileFilter>();
const listeners = new Set<() => void>();

export function setFileFilter(reviewId: string, patch: Partial<FileFilter>): void {
  const next = { ...(byReview.get(reviewId) ?? EMPTY), ...patch };
  if (next.text === '' && !next.needsMe && !next.undecided) byReview.delete(reviewId);
  else byReview.set(reviewId, next);
  listeners.forEach((l) => l());
}
export const clearFileFilter = (reviewId: string): void => setFileFilter(reviewId, EMPTY);
export function resetFileFilters(): void { byReview.clear(); listeners.forEach((l) => l()); }

export function useFileFilter(reviewId: string): FileFilter {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => byReview.get(reviewId) ?? EMPTY);
}
