import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { installFakeEventSource } from '@/test/fakeEventSource';
import { diffFile, fileState, hunk, lines, review, thread } from '@/test/fixtures';
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

/** A /file responder serving `L<n>` lines of a 40-line file. */
const fileLines = (u: URL) => {
  const [s, e] = [Number(u.searchParams.get('start')), Number(u.searchParams.get('end'))];
  return { path: 'src/a.ts', side: 'new', total: 40, lines: Array.from({ length: e - s + 1 }, (_, i) => ({ n: s + i, text: `L${s + i}` })) };
};
const fileCalls = (net: ReturnType<typeof stubFetch>) => net.calls.filter((c) => c.url.pathname.endsWith('/file'))
  .map((c) => [c.url.searchParams.get('side'), c.url.searchParams.get('round')]);

// Invariant: a comparison's file comes from the comparison, never from /diff, and waits for it to load.
test('in a comparison the file comes from the loaded comparison and no /diff is fetched', async () => {
  const net = stubFetch({ 'GET api/reviews/r-1/file': fileLines });
  const file = diffFile({ hunks: [hunk({ verdict: null })] });
  const { result, rerender } = renderHook((p: { files?: ReturnType<typeof diffFile>[] }) =>
    useFileDiff({ reviewId: 'r-1', path: 'src/a.ts', version: 1, uncommitted: false, compare: { from: 1, to: 3, files: p.files, reload: () => {} } }), { initialProps: {} as { files?: ReturnType<typeof diffFile>[] } });
  expect(result.current.loading).toBe(true);
  rerender({ files: [file] });
  expect(result.current.loading).toBe(false);
  expect(result.current.file).toBe(file);
  await vi.waitFor(() => expect(result.current.total).toBe(40));
  expect(net.count('GET api/reviews/r-1/diff')).toBe(0);
});

// Invariant: gap lines are read from a round's head: round B's (new side), and the total too.
test('in a comparison the total and expanded context are read from round B\'s head', async () => {
  const net = stubFetch({ 'GET api/reviews/r-1/file': fileLines });
  const file = diffFile({ hunks: [hunk({ oldStart: 11, newStart: 11, verdict: null })] });
  const { result } = renderHook(() => useFileDiff({ reviewId: 'r-1', path: 'src/a.ts', version: 1, uncommitted: false, compare: { from: 1, to: 3, files: [file], reload: () => {} } }));
  await vi.waitFor(() => expect(result.current.total).toBe(40));
  await act(async () => { await result.current.expand('pre', 'bottom'); });
  expect(fileCalls(net).length).toBeGreaterThan(1);
  expect(fileCalls(net).every(([side, round]) => side === 'new' && round === '3')).toBe(true);
});

// Invariant: a file deleted in the comparison exists only in round A's head, so its context is read there.
test('in a comparison a deleted file\'s context is read from round A\'s head', async () => {
  const net = stubFetch({ 'GET api/reviews/r-1/file': fileLines });
  const file = diffFile({ status: 'deleted', hunks: [hunk({ oldStart: 11, oldLines: 4, newStart: 0, newLines: 0, lines: lines('d1 d2 d3 d4').map((l, i) => ({ ...l, old: 11 + i })), verdict: null })] });
  const { result } = renderHook(() => useFileDiff({ reviewId: 'r-1', path: 'src/a.ts', version: 1, uncommitted: false, compare: { from: 1, to: 3, files: [file], reload: () => {} } }));
  await vi.waitFor(() => expect(result.current.total).toBe(40));
  await act(async () => { await result.current.expand('pre', 'bottom'); });
  expect(fileCalls(net).length).toBeGreaterThan(1);
  expect(fileCalls(net).every(([side, round]) => side === 'new' && round === '1')).toBe(true);
  expect(result.current.rows.some((r) => r.kind === 'line' && r.line.old === 10 && r.line.text === 'L10')).toBe(true);
});

// Invariant: a round-A copy (old side) in collapsed context is revealed, its line read from round B's head by offset.
test('in a comparison an old-side line in a collapsed gap is revealed', async () => {
  stubFetch({ 'GET api/reviews/r-1/file': fileLines });
  // Old 11–14 → new 11–13: after the hunk, old n is new n − 1.
  const h = hunk({
    oldStart: 11, oldLines: 4, newStart: 11, newLines: 3, verdict: null,
    lines: [{ t: 'ctx', old: 11, new: 11, text: 'c' }, { t: 'del', old: 12, new: null, text: 'd' }, { t: 'del', old: 13, new: null, text: 'd' }, { t: 'add', old: null, new: 12, text: 'a' }, { t: 'ctx', old: 14, new: 13, text: 'c' }],
  });
  const { result } = renderHook(() => useFileDiff({ reviewId: 'r-1', path: 'src/a.ts', version: 1, uncommitted: false, compare: { from: 1, to: 3, files: [diffFile({ hunks: [h] })], reload: () => {} } }));
  await vi.waitFor(() => expect(result.current.total).toBe(40));
  act(() => result.current.reveal([{ side: 'old', start: 30, end: 30 }]));
  await vi.waitFor(() => expect(result.current.rows.some((r) => r.kind === 'line' && r.line.old === 30 && r.line.new === 29 && r.line.text === 'L29')).toBe(true));
});

// Invariant: revealing a thread shows every line of its range, not just its last line: a range that starts in collapsed
// context and ends in a hunk, and one wholly inside a gap nearer its bottom edge, both come back with no line hidden.
test('reveal opens enough context to show a whole range', async () => {
  // Hunk new 11–14; gaps: pre 1–10, after:h1 15–40.
  const file = diffFile({ hunks: [hunk({ oldStart: 11, newStart: 11, lines: lines('c1 c2 d3 a3 c4').map((l) => ({ ...l, old: l.old && l.old + 10, new: l.new && l.new + 10 })) })] });
  stubFetch({ 'GET api/reviews/r-1/diff': { review: review(), files: [file] }, 'GET api/reviews/r-1/file': fileLines });
  const { result } = renderHook(() => useFileDiff({ reviewId: 'r-1', path: 'src/a.ts', version: 1, uncommitted: false }));
  await vi.waitFor(() => expect(result.current.total).toBe(40));
  act(() => result.current.reveal([{ side: 'new', start: 8, end: 12 }, { side: 'new', start: 33, end: 37 }]));
  const shown = () => new Set(result.current.rows.flatMap((r) => (r.kind === 'line' && r.line.new != null ? [r.line.new] : [])));
  await vi.waitFor(() => expect([8, 9, 10, 11, 12, 33, 34, 35, 36, 37].filter((n) => !shown().has(n))).toEqual([]));
});
