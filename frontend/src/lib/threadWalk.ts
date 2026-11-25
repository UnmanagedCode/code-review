import { NEEDS_YOU, byPlace } from './threadState';
import type { FileState, GuideView, ThreadDigest } from './types';

type Walked = Pick<ThreadDigest, 'id' | 'anchor' | 'state'>;
const needsYou = (t: Walked) => !!t.state && NEEDS_YOU.includes(t.state);

/** The routed thread and the slot it held when it was routed. */
export interface Slot { id: string; index: number }

/**
 * `placed`: the open threads in place order (`byPlace`, the overview's order). `order`: the same threads with those that
 * need the reviewer first, each part keeping place order. `n`/`p` walk `order`; `u` walks `placed`.
 */
export function walkOrder<T extends Walked>(threads: T[], files: FileState[], guide: GuideView | null): { placed: T[]; order: T[] } {
  const placed = byPlace(threads, files, guide);
  return { placed, order: [...placed.filter(needsYou), ...placed.filter((t) => !needsYou(t))] };
}

/**
 * The thread `n` (dir 1) or `p` (dir -1) goes to, with its slot; null at an end (no wrap). With no current thread `n` goes
 * to the first and `p` to the last. A current thread that moved since it was routed (a reply took it out of the needs-you
 * tier) steps from the slot it was last at, so the threads that slid into place are not skipped.
 */
export function stepThread<T extends { id: string }>(order: T[], currentId: string | undefined, last: Slot | null, dir: 1 | -1): { id: string; index: number } | null {
  const at = currentId === undefined ? -1 : order.findIndex((t) => t.id === currentId);
  let to: number;
  if (last && currentId === last.id && at !== last.index) {
    // `at` before the slot: the thread moved up, so everything from the slot on shifted down by one.
    const movedUp = at !== -1 && at < last.index;
    to = dir === 1 ? last.index + (movedUp ? 1 : 0) : last.index - (movedUp ? 0 : 1);
  } else if (at === -1) {
    to = dir === 1 ? 0 : order.length - 1;
  } else {
    to = at + dir;
  }
  const t = order[to];
  return t ? { id: t.id, index: to } : null;
}

/** The next thread that needs the reviewer after `currentId` in `placed`, wrapping; never the current one. Null when none. */
export function nextNeedsYou<T extends Walked>(placed: T[], currentId: string | undefined): T | null {
  const at = currentId === undefined ? -1 : placed.findIndex((t) => t.id === currentId);
  for (let i = 1; i <= placed.length; i++) {
    const t = placed[(at + i) % placed.length];
    if (t.id !== currentId && needsYou(t)) return t;
  }
  return null;
}
