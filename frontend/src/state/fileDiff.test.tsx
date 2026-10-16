import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { installFakeEventSource } from '@/test/fakeEventSource';
import { diffFile, fileState, hunk, review, thread } from '@/test/fixtures';
import { stubFetch } from '@/test/stubFetch';
import { useDropped } from './dropped';
import { useFileDiff } from './fileDiff';
import { useReview } from './review';

beforeEach(() => installFakeEventSource());

function setup(threadsNow: () => ReturnType<typeof thread>[], kind: 'uncommitted' | 'range' = 'uncommitted') {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  const net = stubFetch({
    'GET api/reviews/r-1': { review: review({ kind }), files: [fileState()], rounds: [], submissions: [], outdatedThreads: [] },
    'GET api/reviews/r-1/diff': () => ({ review: review({ kind }), files: [diffFile({ threads: threadsNow() })] }),
    'GET api/reviews/r-1/file': { path: 'src/a.ts', side: 'new', total: 40, lines: [] },
  });
  const hook = renderHook(() => {
    const r = useReview('r-1');
    const f = useFileDiff({ reviewId: 'r-1', path: 'src/a.ts', version: r.version, uncommitted: kind === 'uncommitted' });
    return { r, f, dropped: useDropped('r-1') };
  });
  return { hook, net };
}

test('an uncommitted file diff is refetched on visibilitychange, focus and the interval', async () => {
  const { net } = setup(() => []);
  await vi.waitFor(() => expect(net.count('GET api/reviews/r-1/diff')).toBe(1));
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
  await vi.waitFor(() => expect(net.count('GET api/reviews/r-1/diff')).toBe(2));
  act(() => { window.dispatchEvent(new Event('focus')); });
  await vi.waitFor(() => expect(net.count('GET api/reviews/r-1/diff')).toBe(3));
  await act(() => vi.advanceTimersByTimeAsync(15_000));
  await vi.waitFor(() => expect(net.count('GET api/reviews/r-1/diff')).toBe(4));
});

test('a thread that vanishes between loads becomes a tombstone holding its last copy; one that returns is cleared', async () => {
  let present = [thread({ id: 't-1' })];
  const { hook } = setup(() => present);
  await vi.waitFor(() => expect(hook.result.current.f.file?.threads).toHaveLength(1));
  present = [];
  act(() => { window.dispatchEvent(new Event('focus')); });
  await vi.waitFor(() => expect(hook.result.current.dropped.map((t) => t.id)).toEqual(['t-1']));
  expect(hook.result.current.dropped[0].messages[0].body).toBe('hello');
  present = [thread({ id: 't-1' })];
  act(() => { window.dispatchEvent(new Event('focus')); });
  await vi.waitFor(() => expect(hook.result.current.dropped).toEqual([]));
});

test('a range review never records tombstones', async () => {
  let present = [thread({ id: 't-1' })];
  const { hook } = setup(() => present, 'range');
  await vi.waitFor(() => expect(hook.result.current.f.file?.threads).toHaveLength(1));
  present = [];
  act(() => hook.result.current.r.reload());
  await vi.waitFor(() => expect(hook.result.current.f.file?.threads).toHaveLength(0));
  expect(hook.result.current.dropped).toEqual([]);
});

test('expanding a gap fetches only the window it reveals and renders those lines as context', async () => {
  const net = stubFetch({
    'GET api/reviews/r-1/diff': { review: review(), files: [diffFile({ hunks: [hunk({ oldStart: 11, newStart: 11 })] })] },
    'GET api/reviews/r-1/file': (u: URL) => {
      const [s, e] = [Number(u.searchParams.get('start')), Number(u.searchParams.get('end'))];
      return { path: 'src/a.ts', side: 'new', total: 40, lines: Array.from({ length: e - s + 1 }, (_, i) => ({ n: s + i, text: `L${s + i}` })) };
    },
  });
  const { result } = renderHook(() => useFileDiff({ reviewId: 'r-1', path: 'src/a.ts', version: 1, uncommitted: false }));
  await vi.waitFor(() => expect(result.current.total).toBe(40));
  await act(async () => { await result.current.expand('pre', 'bottom'); });
  const fetched = net.calls.filter((c) => c.url.pathname.endsWith('/file') && c.url.searchParams.get('end') !== '1');
  expect(fetched.map((c) => [c.url.searchParams.get('start'), c.url.searchParams.get('end')])).toEqual([['1', '10']]);
  const ctx = result.current.rows.filter((r) => r.kind === 'line' && r.key.startsWith('pre:'));
  expect(ctx).toHaveLength(10);
});

test('a past-round file diff and its context expansion are read from that round', async () => {
  const net = stubFetch({
    'GET api/reviews/r-1/diff': { readOnly: true, round: { n: 1 }, files: [diffFile({ hunks: [hunk({ oldStart: 11, newStart: 11 })] })] },
    'GET api/reviews/r-1/file': (u: URL) => {
      const [s, e] = [Number(u.searchParams.get('start')), Number(u.searchParams.get('end'))];
      return { path: 'src/a.ts', side: 'new', total: 40, lines: Array.from({ length: e - s + 1 }, (_, i) => ({ n: s + i, text: `L${s + i}` })) };
    },
  });
  const { result } = renderHook(() => useFileDiff({ reviewId: 'r-1', path: 'src/a.ts', version: 1, uncommitted: false, round: 1 }));
  await vi.waitFor(() => expect(result.current.total).toBe(40));
  await act(async () => { await result.current.expand('pre', 'bottom'); });
  const diff = net.calls.find((c) => c.url.pathname.endsWith('/diff'))!;
  expect([diff.url.searchParams.get('file'), diff.url.searchParams.get('round')]).toEqual(['src/a.ts', '1']);
  const files = net.calls.filter((c) => c.url.pathname.endsWith('/file'));
  expect(files.length).toBeGreaterThan(1);
  expect(files.every((c) => c.url.searchParams.get('round') === '1')).toBe(true);
});

test('moving between rounds refetches the open file for the new round', async () => {
  const net = stubFetch({
    'GET api/reviews/r-1/diff': { review: review(), files: [diffFile()] },
    'GET api/reviews/r-1/file': { path: 'src/a.ts', side: 'new', total: 4, lines: [] },
  });
  const { rerender } = renderHook((p: { round?: number }) => useFileDiff({ reviewId: 'r-1', path: 'src/a.ts', version: 1, uncommitted: false, round: p.round }), { initialProps: { round: 1 } as { round?: number } });
  await vi.waitFor(() => expect(net.count('GET api/reviews/r-1/diff')).toBe(1));
  rerender({ round: undefined });
  await vi.waitFor(() => expect(net.count('GET api/reviews/r-1/diff')).toBe(2));
  const diffs = net.calls.filter((c) => c.url.pathname.endsWith('/diff'));
  expect(diffs.map((c) => c.url.searchParams.get('round'))).toEqual(['1', null]);
});
