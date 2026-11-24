import { expect, test } from 'vitest';
import { fileState, groupAnchor, guideGroup, guideView, linesAnchor, threadDigest } from '@/test/fixtures';
import { byPlace } from './threadState';
import { nextNeedsYou, stepThread, walkOrder } from './threadWalk';

const files = [fileState({ path: 'a.ts' }), fileState({ path: 'b.ts' })];
const at = (file: string, startLine: number) => linesAnchor({ file, startLine, endLine: startLine });
const t = (id: string, file: string, line: number, state: 'awaiting-human' | 'verify-resolution' | 'unsent' | 'awaiting-agent') =>
  threadDigest({ id, state, anchor: at(file, line) });

const threads = [t('t1', 'a.ts', 1, 'unsent'), t('t2', 'a.ts', 5, 'awaiting-human'), t('t3', 'b.ts', 1, 'awaiting-agent'), t('t4', 'b.ts', 9, 'verify-resolution'), t('t5', 'b.ts', 20, 'unsent')];
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

// Invariant: the walk lists the threads that need the reviewer (awaiting-human, verify-resolution) before all others, and each part keeps the overview's place order.
test('needs-you threads precede all others; each part keeps byPlace order', () => {
  const { placed, order } = walkOrder(threads, files, null);
  expect(ids(placed)).toEqual(ids(byPlace(threads, files)));
  expect(ids(order)).toEqual(['t2', 't4', 't1', 't3', 't5']);
});

// Invariant: group threads sort by their group's step when the guide is passed, so the walk and the overview agree.
test('group threads are placed by their group step', () => {
  const guide = guideView({ groups: [guideGroup({ id: 'g1' }), guideGroup({ id: 'g2' })] });
  const g = (id: string, groupId: string) => threadDigest({ id, state: 'unsent', anchor: groupAnchor({ groupId }) });
  expect(ids(walkOrder([g('x2', 'g2'), g('x1', 'g1')], files, guide).order)).toEqual(['x1', 'x2']);
});

// Invariant: n and p stop at the ends; with no current thread n goes to the first and p to the last.
test("n/p don't wrap; with no current thread n goes to the first and p to the last", () => {
  const { order } = walkOrder(threads, files, null);
  expect(stepThread(order, undefined, null, 1)).toEqual({ id: 't2', index: 0 });
  expect(stepThread(order, undefined, null, -1)).toEqual({ id: 't5', index: 4 });
  expect(stepThread(order, 't5', null, 1)).toBeNull();
  expect(stepThread(order, 't2', null, -1)).toBeNull();
  expect(stepThread(order, 't4', null, 1)).toEqual({ id: 't1', index: 2 });
  expect(stepThread(order, 'gone', null, 1)).toEqual({ id: 't2', index: 0 });
});

// Invariant: a reply moves the routed thread out of the needs-you tier, and the next n continues from the slot it held, so no needs-you thread is skipped.
test('stepping from a thread that left the needs-you tier continues from its old slot', () => {
  const before = walkOrder(threads, files, null).order; // t2 t4 t1 t3 t5
  const first = stepThread(before, undefined, null, 1)!; // t2 at slot 0
  const replied = threads.map((x) => (x.id === 't2' ? { ...x, state: 'unsent' as const } : x));
  const after = walkOrder(replied, files, null).order; // t4 t1 t2 t3 t5
  expect(after.findIndex((x) => x.id === 't2')).toBe(2);
  expect(stepThread(after, 't2', first, 1)).toEqual({ id: 't4', index: 0 });
  // Going back from the slot has nothing before it.
  expect(stepThread(after, 't2', first, -1)).toBeNull();
});

// Invariant: a thread that moved up (an agent replied, so it now needs the reviewer) steps on to what followed it, not back over what was before.
test('stepping from a thread that moved up continues after its old slot', () => {
  const { order } = walkOrder(threads, files, null); // t2 t4 t1 t3 t5
  const now = [order[2], order[0], order[1], order[3], order[4]]; // t1 moved up to the front
  expect(ids(now)).toEqual(['t1', 't2', 't4', 't3', 't5']);
  expect(stepThread(now, 't1', { id: 't1', index: 2 }, 1)).toEqual({ id: 't3', index: 3 });
  expect(stepThread(now, 't1', { id: 't1', index: 2 }, -1)).toEqual({ id: 't4', index: 2 });
});

// Invariant: u goes to the next needs-you thread after the current place, wrapping, never to the current thread, and is null when none remain.
test('u wraps through the needs-you threads from the current place and is null when none remain', () => {
  const { placed } = walkOrder(threads, files, null); // place order: t1 t2 t3 t4 t5
  expect(nextNeedsYou(placed, undefined)?.id).toBe('t2');
  expect(nextNeedsYou(placed, 't2')?.id).toBe('t4');
  expect(nextNeedsYou(placed, 't4')?.id).toBe('t2');
  expect(nextNeedsYou(placed, 't5')?.id).toBe('t2');
  const none = walkOrder(threads.map((x) => ({ ...x, state: 'unsent' as const })), files, null).placed;
  expect(nextNeedsYou(none, undefined)).toBeNull();
  const one = walkOrder([threads[1], threads[0]], files, null).placed;
  expect(nextNeedsYou(one, 't2')).toBeNull();
});
