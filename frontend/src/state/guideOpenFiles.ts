import { useSyncExternalStore } from 'react';

/**
 * Which file bars of a guided step are open. Absent means collapsed, so the default costs nothing. Kept outside any
 * component (like `clearedGroups.ts`) because "Open in file" unmounts the step view and Back remounts it.
 */
const byStep = new Map<string, Set<string>>();
const listeners = new Set<() => void>();
let snapshot: Record<string, ReadonlySet<string>> = {};

const keyOf = (reviewId: string, stepKey: string) => `${reviewId}\n${stepKey}`;

function publish() {
  snapshot = Object.fromEntries([...byStep].map(([k, s]) => [k, new Set(s)]));
  listeners.forEach((l) => l());
}

export function setFileOpen(reviewId: string, stepKey: string, path: string, open: boolean): void {
  const key = keyOf(reviewId, stepKey);
  const cur = byStep.get(key);
  if (open === !!cur?.has(path)) return;
  if (open) (cur ?? byStep.set(key, new Set()).get(key)!).add(path);
  else cur!.delete(path);
  publish();
}
export function resetGuideOpenFiles(): void { byStep.clear(); publish(); }

const none: ReadonlySet<string> = new Set();
export function useOpenFiles(reviewId: string, stepKey: string): ReadonlySet<string> {
  const all = useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, () => snapshot);
  return all[keyOf(reviewId, stepKey)] ?? none;
}
