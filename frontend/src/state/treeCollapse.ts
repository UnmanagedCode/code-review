import { useSyncExternalStore } from 'react';

const EMPTY: ReadonlySet<string> = new Set();

/**
 * The file tree's collapsed folders (`TreeNode.path`) per review, kept outside any component (like `fileFilter.ts`) because a phone
 * unmounts the tree whenever a file is open and the state must survive that round trip. Absent means everything is expanded.
 * `revealPath` is an action, run when the open file changes, rather than a derived "always show the open file": the user can still
 * collapse the open file's own folder afterwards.
 */
const byReview = new Map<string, ReadonlySet<string>>();
const listeners = new Set<() => void>();
const publish = () => listeners.forEach((l) => l());

function store(reviewId: string, next: Set<string>): void {
  if (next.size === 0) byReview.delete(reviewId);
  else byReview.set(reviewId, next);
  publish();
}

export function setFolderCollapsed(reviewId: string, dir: string, collapsed: boolean): void {
  const cur = byReview.get(reviewId) ?? EMPTY;
  if (cur.has(dir) === collapsed) return;
  const next = new Set(cur);
  if (collapsed) next.add(dir); else next.delete(dir);
  store(reviewId, next);
}

/** Expands every ancestor directory of `filePath` ('a' and 'a/b' for 'a/b/c.ts'); a no-op when none is collapsed. */
export function revealPath(reviewId: string, filePath: string): void {
  const cur = byReview.get(reviewId);
  if (!cur) return;
  const parts = filePath.split('/').slice(0, -1);
  const next = new Set(cur);
  parts.forEach((_, i) => next.delete(parts.slice(0, i + 1).join('/')));
  if (next.size !== cur.size) store(reviewId, next);
}

export function resetTreeCollapse(): void { byReview.clear(); publish(); }

export function useCollapsedFolders(reviewId: string): ReadonlySet<string> {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => byReview.get(reviewId) ?? EMPTY);
}
