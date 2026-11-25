import { useSyncExternalStore } from 'react';

/**
 * The open/closed choices made on a guided step's file bars. A path with no entry was never toggled, so its section falls back
 * to its default: the step's first file open, the rest collapsed. Kept outside any component (like `clearedGroups.ts`) because
 * "Open in file" unmounts the step view and Back remounts it.
 */
const byStep = new Map<string, Map<string, boolean>>();
const listeners = new Set<() => void>();
let snapshot: Record<string, ReadonlyMap<string, boolean>> = {};

const keyOf = (reviewId: string, stepKey: string) => `${reviewId}\n${stepKey}`;

function publish() {
  snapshot = Object.fromEntries([...byStep].map(([k, m]) => [k, new Map(m)]));
  listeners.forEach((l) => l());
}

export function setFileOpen(reviewId: string, stepKey: string, path: string, open: boolean): void {
  const key = keyOf(reviewId, stepKey);
  const cur = byStep.get(key) ?? byStep.set(key, new Map()).get(key)!;
  if (cur.get(path) === open) return;
  cur.set(path, open);
  publish();
}
export function resetGuideOpenFiles(): void { byStep.clear(); publish(); }

/** The recorded choice for a file bar, `undefined` when none was made. */
export function useFileOpen(reviewId: string, stepKey: string, path: string): boolean | undefined {
  const all = useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, () => snapshot);
  return all[keyOf(reviewId, stepKey)]?.get(path);
}
