import { useSyncExternalStore } from 'react';

/**
 * Groups the server set back to pending because you changed one of their hunks' verdicts: session-local marks the step
 * view explains with a note. Keyed outside any component like `drafts.ts`; a mark shows only while the group is pending.
 */
const byReview = new Map<string, Set<string>>();
const listeners = new Set<() => void>();
let snapshot: Record<string, ReadonlySet<string>> = {};

function publish() {
  snapshot = Object.fromEntries([...byReview].map(([id, s]) => [id, new Set(s)]));
  listeners.forEach((l) => l());
}

export function noteCleared(reviewId: string, groupIds: string[]): void {
  if (!groupIds.length) return;
  const s = byReview.get(reviewId) ?? byReview.set(reviewId, new Set()).get(reviewId)!;
  groupIds.forEach((g) => s.add(g));
  publish();
}
export function forgetCleared(reviewId: string, groupId: string): void {
  if (!byReview.get(reviewId)?.delete(groupId)) return;
  publish();
}
export function resetClearedGroups(): void { byReview.clear(); publish(); }

const none: ReadonlySet<string> = new Set();
export function useClearedGroups(reviewId: string): ReadonlySet<string> {
  const all = useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, () => snapshot);
  return all[reviewId] ?? none;
}
