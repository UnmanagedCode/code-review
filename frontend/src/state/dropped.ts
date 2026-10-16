import { useSyncExternalStore } from 'react';
import type { Thread } from '@/lib/types';

/** Uncommitted threads the backend dropped because their lines changed: session-local, built from the last copy fetched. */
const byReview = new Map<string, Map<string, Thread>>();
const listeners = new Set<() => void>();
let snapshot: Record<string, Thread[]> = {};

function publish() {
  snapshot = Object.fromEntries([...byReview].map(([id, m]) => [id, [...m.values()]]));
  listeners.forEach((l) => l());
}

export function recordDropped(reviewId: string, threads: Thread[]): void {
  if (!threads.length) return;
  const m = byReview.get(reviewId) ?? byReview.set(reviewId, new Map()).get(reviewId)!;
  threads.forEach((t) => m.set(t.id, t));
  publish();
}
export function clearReturned(reviewId: string, ids: string[]): void {
  const m = byReview.get(reviewId);
  if (!m || !ids.some((i) => m.delete(i))) return;
  publish();
}
export function resetDropped(): void { byReview.clear(); publish(); }

const none: Thread[] = [];
export function useDropped(reviewId: string | undefined): Thread[] {
  const all = useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, () => snapshot);
  return (reviewId && all[reviewId]) || none;
}
