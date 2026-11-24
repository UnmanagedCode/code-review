import { treeOrder } from './fileTree';
import { anchorLabel } from './ranges';
import type { Anchor, FileState, GuideView, ThreadState } from './types';

/** States in which the human is the one to act. Mirrors `NEEDS_YOU` in `src/threadState.js`. */
export const NEEDS_YOU: readonly ThreadState[] = ['awaiting-human', 'verify-resolution'];

export const STATE_LABEL: Record<ThreadState, string> = {
  'awaiting-human': 'Needs your reply',
  'verify-resolution': 'Agent says fixed — verify',
  unsent: 'Will be sent',
  'awaiting-agent': 'Waiting on agent',
};

export type StateGroup = 'needs-you' | 'unsent' | 'waiting';

/** The `need=` filter group of a state; null for no state. */
export function stateGroup(state: ThreadState | null | undefined): StateGroup | null {
  if (!state) return null;
  return state === 'unsent' ? 'unsent' : state === 'awaiting-agent' ? 'waiting' : 'needs-you';
}

export const GROUP_LABEL: Record<StateGroup, string> = { 'needs-you': 'Needs you', unsent: 'Will be sent', waiting: 'Waiting on agent' };

type Placed = { anchor: Anchor };

/**
 * Threads in place order: file tree order, old side before new, start line, a file thread before line threads; then group
 * threads in their group's step order (`guide`; the guide lists groups in step order), then review threads (each stable in the given order).
 */
export function byPlace<T extends Placed>(threads: T[], files: FileState[], guide: GuideView | null = null): T[] {
  const rank = new Map(treeOrder(files).map((f, i) => [f.path, i]));
  // A group thread sits at its group's step; a group the guide no longer lists (retired) comes after the listed ones.
  const step = new Map(guide?.groups.map((g, i) => [g.id, i]));
  const group = (a: Anchor) => (a.kind === 'group' ? 1 : a.kind === 'review' ? 2 : 0);
  const key = (a: Anchor): number[] => {
    if (a.kind === 'lines') return [rank.get(a.file) ?? Infinity, 1, a.side === 'old' ? 0 : 1, a.startLine];
    if (a.kind === 'file') return [rank.get(a.file) ?? Infinity, 0, 0, 0];
    return [a.kind === 'group' ? step.get(a.groupId) ?? Infinity : 0, 0, 0, 0];
  };
  return [...threads].sort((x, y) => {
    const g = group(x.anchor) - group(y.anchor);
    if (g) return g;
    const kx = key(x.anchor), ky = key(y.anchor);
    for (let i = 0; i < kx.length; i++) if (kx[i] !== ky[i]) return kx[i] < ky[i] ? -1 : 1;
    return 0;
  });
}

/** Where a thread sits, in words: `path#L3–L5`, `path (whole file)`, `Review`, `Group: <title>`. */
export function placeLabel(a: Anchor, guide: GuideView | null): string {
  if (a.kind === 'review') return 'Review';
  if (a.kind === 'group') return `Group: ${guide?.groups.find((g) => g.id === a.groupId)?.title ?? guide?.retired.find((g) => g.id === a.groupId)?.title ?? a.groupId}`;
  if (a.kind === 'file') return `${a.file} (whole file)`;
  return `${a.file}#${anchorLabel(a).replace(/ \((old|new)\)$/, '')}`;
}

const base = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** A thread's place in few characters: `a.ts#L3–L5`, `a.ts` (whole file), `review`, or its group's title. */
export function shortPlace(a: Anchor, guide: GuideView | null = null): string {
  if (a.kind === 'review') return 'review';
  if (a.kind === 'group') return guide?.groups.find((g) => g.id === a.groupId)?.title ?? guide?.retired.find((g) => g.id === a.groupId)?.title ?? 'a group';
  if (a.kind === 'file') return base(a.file);
  return `${base(a.file)}#${anchorLabel(a).replace(/ \((old|new)\)$/, '')}`;
}
