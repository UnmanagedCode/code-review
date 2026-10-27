import { renderHook } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { diffFile, fileState, review, thread } from '@/test/fixtures';
import { stubFetch } from '@/test/stubFetch';
import { diffKey, diffSpec } from './diffResource';
import { ensure } from './resource';
import { useThreadIndex } from './threadIndex';

const withThreads = { open: 1, resolved: 0, outdated: 0 };
const file = (path: string, sig: string) => fileState({ path, threads: withThreads, sig });
const world = () => {
  const sigs: Record<string, string> = { a: 'a1', b: 'b1', c: 'c1' };
  const net = stubFetch({
    'GET api/reviews/r-1/diff': (u: URL) => {
      const path = u.searchParams.get('file')!;
      return { review: review(), files: [diffFile({ path, sig: sigs[path], threads: [thread({ id: `t-${path}`, anchor: { ...thread().anchor, file: path } })] })] };
    },
  });
  const files = (sigOf: (p: string) => string) => ['a', 'b', 'c'].map((p) => file(p, sigOf(p)));
  return { sigs, net, files };
};
const diffCalls = (net: ReturnType<typeof stubFetch>) => net.calls.map((c) => c.url.searchParams.get('file'));

// Invariant: of the files that have threads, only those whose sig moved are fetched again.
test('a reload that moves one file\'s sig fetches one diff', async () => {
  const w = world();
  const { result, rerender } = renderHook(({ files }) => useThreadIndex('r-1', files, true), { initialProps: { files: w.files((p) => w.sigs[p]) } });
  await until(() => result.current.threads.length === 3);
  expect(diffCalls(w.net).sort()).toEqual(['a', 'b', 'c']);
  w.sigs.b = 'b2';
  rerender({ files: w.files((p) => w.sigs[p]) });
  await until(() => w.net.calls.length === 4);
  expect(diffCalls(w.net).slice(3)).toEqual(['b']);
  await until(() => !result.current.loading);
  expect(result.current.threads).toHaveLength(3);
});

// Invariant: a file the open view already cached at the current sig is read from that entry, never fetched twice.
test('an already cached file at the current sig is not fetched', async () => {
  const w = world();
  await ensure(diffKey('r-1', undefined, 'a'), diffSpec('r-1', undefined, 'a'));
  w.net.calls.length = 0;
  const { result } = renderHook(() => useThreadIndex('r-1', w.files((p) => w.sigs[p]), true));
  await until(() => result.current.threads.length === 3);
  expect(diffCalls(w.net).sort()).toEqual(['b', 'c']);
});

// Invariant: idle until enabled.
test('nothing is fetched while disabled', async () => {
  const w = world();
  renderHook(() => useThreadIndex('r-1', w.files((p) => w.sigs[p]), false));
  await Promise.resolve();
  expect(w.net.calls).toHaveLength(0);
});

const until = (cond: () => boolean) => vi.waitFor(() => expect(cond()).toBe(true));
