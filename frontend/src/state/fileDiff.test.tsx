import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { installFakeEventSource } from '@/test/fakeEventSource';
import { diffFile, fileState, hunk, lines, review, thread } from '@/test/fixtures';
import { stubFetch } from '@/test/stubFetch';
import { setDiffPrefs } from './diffPrefs';
import { useDropped } from './dropped';
import { useFileDiff } from './fileDiff';
import { POLL_MS, REFOCUS_MIN_MS } from './live';
import { resetResources } from './resource';
import { useReview } from './review';

beforeEach(() => installFakeEventSource());

function setup(threadsNow: () => ReturnType<typeof thread>[], kind: 'uncommitted' | 'range' = 'uncommitted') {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
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

test('an uncommitted file diff is refetched once for focus and visibilitychange together, then on the interval', async () => {
  const { net } = setup(() => []);
  await vi.waitFor(() => expect(net.count('GET api/reviews/r-1/diff')).toBeGreaterThan(0));
  await act(() => vi.advanceTimersByTimeAsync(0));
  const diffs = () => net.count('GET api/reviews/r-1/diff');
  const base = diffs();
  await act(() => vi.advanceTimersByTimeAsync(REFOCUS_MIN_MS));
  act(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); });
  await vi.waitFor(() => expect(diffs()).toBe(base + 1));
  await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
  await vi.waitFor(() => expect(diffs()).toBe(base + 2));
});

test('a thread that vanishes between loads becomes a tombstone holding its last copy; one that returns is cleared', async () => {
  let present = [thread({ id: 't-1' })];
  const { hook } = setup(() => present);
  await vi.waitFor(() => expect(hook.result.current.f.file?.threads).toHaveLength(1));
  present = [];
  await act(() => vi.advanceTimersByTimeAsync(REFOCUS_MIN_MS));
  act(() => { window.dispatchEvent(new Event('focus')); });
  await vi.waitFor(() => expect(hook.result.current.dropped.map((t) => t.id)).toEqual(['t-1']));
  expect(hook.result.current.dropped[0].messages[0].body).toBe('hello');
  present = [thread({ id: 't-1' })];
  await act(() => vi.advanceTimersByTimeAsync(REFOCUS_MIN_MS));
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

// Diff options. Hunk new 11–14 of a 40-line file: pre 1–10, after:h1 15–40.
const mid = () => diffFile({ hunks: [hunk({ oldStart: 11, oldLines: 4, newStart: 11, newLines: 4, lines: lines('c1 c2 d3 a3 c4').map((l) => ({ ...l, old: l.old && l.old + 10, new: l.new && l.new + 10 })) })] });
const windows = (net: ReturnType<typeof stubFetch>) => net.calls.filter((c) => c.url.pathname.endsWith('/file') && c.url.searchParams.get('end') !== '1')
  .map((c) => [Number(c.url.searchParams.get('start')), Number(c.url.searchParams.get('end'))]);
const shownNew = (rows: ReturnType<typeof useFileDiff>['rows']) => rows.flatMap((r) => (r.kind === 'line' && r.line.new != null ? [r.line.new] : []));

// Invariant: more context than git's reads only the baseline windows beside the hunk, and shows them with their text.
test('context 10 fetches only the baseline windows and renders them; back to 3 hides them with no fetch', async () => {
  const net = stubFetch({ 'GET api/reviews/r-1/diff': { review: review(), files: [mid()] }, 'GET api/reviews/r-1/file': fileLines });
  const { result } = renderHook(() => useFileDiff({ reviewId: 'r-1', path: 'src/a.ts', version: 1, uncommitted: false }));
  await vi.waitFor(() => expect(result.current.total).toBe(40));
  act(() => setDiffPrefs({ context: 10 }));
  await vi.waitFor(() => expect(shownNew(result.current.rows)).toEqual(Array.from({ length: 18 }, (_, i) => 4 + i)));
  expect(windows(net).sort((a, b) => a[0] - b[0])).toEqual([[4, 10], [15, 21]]);
  expect(result.current.rows.find((r) => r.kind === 'line' && r.line.new === 4)).toMatchObject({ line: { text: 'L4' } });
  const before = net.calls.length;
  act(() => setDiffPrefs({ context: 3 }));
  expect(shownNew(result.current.rows)).toEqual([11, 12, 13, 14]);
  expect(net.calls.length).toBe(before);
});

// Invariant: "Show 20 above" grows what is visible, counting the baseline lines already shown.
test('expanding a gap grows from the effective expansion', async () => {
  stubFetch({ 'GET api/reviews/r-1/diff': { review: review(), files: [mid()] }, 'GET api/reviews/r-1/file': fileLines });
  const { result } = renderHook(() => useFileDiff({ reviewId: 'r-1', path: 'src/a.ts', version: 1, uncommitted: false }));
  await vi.waitFor(() => expect(result.current.total).toBe(40));
  act(() => setDiffPrefs({ context: 5 }));
  await vi.waitFor(() => expect(shownNew(result.current.rows)).toContain(16));
  await act(async () => { await result.current.expand('after:h1', 'top'); });
  expect(shownNew(result.current.rows).filter((n) => n > 14)).toEqual(Array.from({ length: 22 }, (_, i) => 15 + i));
});

// Invariant: trimmed lines carry their text with them, so reopening one costs no fetch.
test('context 0 moves edge context into the gaps, and re-expanding a trimmed line makes no fetch', async () => {
  const net = stubFetch({ 'GET api/reviews/r-1/diff': { review: review(), files: [mid()] }, 'GET api/reviews/r-1/file': fileLines });
  const { result } = renderHook(() => useFileDiff({ reviewId: 'r-1', path: 'src/a.ts', version: 1, uncommitted: false }));
  await vi.waitFor(() => expect(result.current.total).toBe(40));
  act(() => setDiffPrefs({ context: 0 }));
  expect(shownNew(result.current.rows)).toEqual([13]);
  expect(result.current.rows.find((r) => r.kind === 'gap' && r.gapKey === 'pre')).toMatchObject({ from: 1, to: 12 });
  const before = net.calls.length;
  act(() => result.current.reveal([{ side: 'new', start: 11, end: 12 }]));
  await vi.waitFor(() => expect(shownNew(result.current.rows)).toEqual([11, 12, 13]));
  expect(result.current.rows.find((r) => r.kind === 'line' && r.line.new === 11)).toMatchObject({ line: { text: 'c1' } });
  expect(net.calls.length).toBe(before);
});

// Invariant: a comparison's baseline lines are read from round B's head, like any gap line there.
test('in a comparison the context baseline reads round B\'s head', async () => {
  const net = stubFetch({ 'GET api/reviews/r-1/file': fileLines });
  const { result } = renderHook(() => useFileDiff({ reviewId: 'r-1', path: 'src/a.ts', version: 1, uncommitted: false, compare: { from: 1, to: 3, files: [mid()], reload: () => {} } }));
  await vi.waitFor(() => expect(result.current.total).toBe(40));
  act(() => setDiffPrefs({ context: 10 }));
  await vi.waitFor(() => expect(shownNew(result.current.rows)).toContain(4));
  expect(fileCalls(net).every(([side, round]) => side === 'new' && round === '3')).toBe(true);
});

// --- sig-gated refetch, line counts, switching ---------------------------------------------------------------------

const PATHS = ['src/a.ts', 'src/b.ts'];
function sigWorld(opts: { sig?: boolean; lineCount?: boolean; gate?: Record<string, Promise<void>> } = {}) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  installFakeEventSource();
  const sigs: Record<string, string> = { 'src/a.ts': 'a1', 'src/b.ts': 'b1' };
  const withSig = opts.sig !== false;
  const net = stubFetch({
    'GET api/reviews/r-1': () => ({
      review: review({ kind: 'uncommitted' }), rounds: [], submissions: [], outdatedThreads: [],
      files: PATHS.map((path) => fileState({ path, ...(withSig ? { sig: sigs[path] } : {}) })),
    }),
    'GET api/reviews/r-1/diff': async (u: URL) => {
      const path = u.searchParams.get('file')!;
      await opts.gate?.[path];
      return { review: review(), files: [diffFile({ path, ...(withSig ? { sig: sigs[path] } : {}), ...(opts.lineCount ? { lineCount: { old: 40, new: 40 } } : {}) })] };
    },
    'GET api/reviews/r-1/file': { path: 'src/a.ts', side: 'new', total: 40, lines: [] },
  });
  const hook = renderHook(({ path }) => {
    const r = useReview('r-1');
    const sig = r.data?.files.find((f) => f.path === path)?.sig;
    return { r, f: useFileDiff({ reviewId: 'r-1', path, sig, version: r.version, uncommitted: true }) };
  }, { initialProps: { path: 'src/a.ts' } });
  const settle = () => act(() => vi.advanceTimersByTimeAsync(0));
  const diffs = () => net.count('GET api/reviews/r-1/diff');
  const reviews = () => net.count('GET api/reviews/r-1');
  return { sigs, net, hook, settle, diffs, reviews, reload: () => act(() => hook.result.current.r.reload()) };
}

// Invariant: a review reload that leaves the open file's sig alone costs no diff fetch; a moved sig costs exactly one.
test('the open file is refetched only when its sig moves', async () => {
  const w = sigWorld();
  await vi.waitFor(() => expect(w.hook.result.current.f.file).toBeDefined());
  await w.settle();
  expect([w.reviews(), w.diffs()]).toEqual([1, 1]);
  await w.reload(); await w.settle();
  expect([w.reviews(), w.diffs()]).toEqual([2, 1]);
  w.sigs['src/a.ts'] = 'a2';
  await w.reload(); await w.settle();
  expect([w.reviews(), w.diffs()]).toEqual([3, 2]);
  expect(w.hook.result.current.f.file?.sig).toBe('a2');
});

// Invariant: another file's change (the review's version moves, the open file's sig does not) does not refetch the open diff.
test('a reload that moves only another file\'s sig leaves the open diff alone', async () => {
  const w = sigWorld();
  await vi.waitFor(() => expect(w.hook.result.current.f.file).toBeDefined());
  await w.settle();
  w.sigs['src/b.ts'] = 'b2';
  await w.reload(); await w.settle();
  expect(w.hook.result.current.r.version).toBe(2);
  expect(w.diffs()).toBe(1);
});

// Invariant: without a sig the open diff refetches on every review load that moves the version (today's behaviour, the fallback).
test('without a sig, every version move refetches the open diff', async () => {
  const w = sigWorld({ sig: false });
  await vi.waitFor(() => expect(w.hook.result.current.f.file).toBeDefined());
  await w.settle();
  const base = w.diffs();
  await w.reload(); await w.settle();
  expect(w.diffs()).toBe(base + 1);
  await w.reload(); await w.settle();
  expect(w.diffs()).toBe(base + 2);
});

// Invariant: a lineCount in the diff response replaces the one-line `file` read for the total (old side for a deleted file).
test('lineCount supplies the total without a file read; absent, one read does', async () => {
  const withCount = sigWorld({ lineCount: true });
  await vi.waitFor(() => expect(withCount.hook.result.current.f.total).toBe(40));
  expect(withCount.net.count('GET api/reviews/r-1/file')).toBe(0);
  withCount.hook.unmount();
  resetResources(); // the cached diff of the same key would answer the next world

  const none = sigWorld();
  await vi.waitFor(() => expect(none.hook.result.current.f.total).toBe(40));
  expect(none.net.count('GET api/reviews/r-1/file')).toBe(1);
  none.hook.unmount();
  resetResources();

  const net = stubFetch({ 'GET api/reviews/r-1/diff': { review: review(), files: [{ ...diffFile({ status: 'deleted' }), lineCount: { old: 7, new: null } }] } });
  const { result } = renderHook(() => useFileDiff({ reviewId: 'r-1', path: 'src/a.ts', version: 1, uncommitted: false }));
  await vi.waitFor(() => expect(result.current.total).toBe(7));
  expect(net.count('GET api/reviews/r-1/file')).toBe(0);
});

// Invariant: switching to an uncached file keeps the previous file (flagged `switching`), makes no line reads for it, then shows the new file.
test('an uncached file switch shows the previous file as switching, then the new one', async () => {
  let open!: () => void;
  const w = sigWorld({ lineCount: true, gate: { 'src/b.ts': new Promise<void>((r) => { open = r; }) } });
  await vi.waitFor(() => expect(w.hook.result.current.f.file?.path).toBe('src/a.ts'));
  await w.settle();
  w.hook.rerender({ path: 'src/b.ts' });
  await w.settle();
  const f = () => w.hook.result.current.f;
  expect(f()).toMatchObject({ switching: true, loading: true });
  expect(f().file?.path).toBe('src/a.ts');
  await act(async () => { await f().expand('pre', 'bottom'); f().reveal([{ side: 'new', start: 1, end: 1 }]); });
  expect(w.net.count('GET api/reviews/r-1/file')).toBe(0);
  await act(async () => { open(); });
  await w.settle();
  expect(f()).toMatchObject({ switching: false, loading: false });
  expect(f().file?.path).toBe('src/b.ts');
});

// Invariant: revisiting a cached file whose sig is unchanged costs no fetch and shows at once.
test('revisiting a cached file with an unchanged sig fetches nothing', async () => {
  const w = sigWorld({ lineCount: true });
  await vi.waitFor(() => expect(w.hook.result.current.f.file?.path).toBe('src/a.ts'));
  w.hook.rerender({ path: 'src/b.ts' });
  await vi.waitFor(() => expect(w.hook.result.current.f.file?.path).toBe('src/b.ts'));
  await w.settle();
  const base = w.diffs();
  w.hook.rerender({ path: 'src/a.ts' });
  expect(w.hook.result.current.f.file?.path).toBe('src/a.ts');
  await w.settle();
  expect(w.diffs()).toBe(base);
});

// Invariant: a write response's fileSig makes the patched cached diff current, so the following review reload refetches no diff.
test('a fileSig from a write response removes the own-write refetch', async () => {
  const w = sigWorld();
  await vi.waitFor(() => expect(w.hook.result.current.f.file).toBeDefined());
  await w.settle();
  act(() => { w.hook.result.current.f.patchThread(thread({ id: 't-9' })); w.hook.result.current.f.patchSig({ path: 'src/a.ts', sig: 'a2' }); });
  w.sigs['src/a.ts'] = 'a2';
  await w.reload(); await w.settle();
  expect(w.diffs()).toBe(1);
  expect(w.hook.result.current.f.file?.threads.map((t) => t.id)).toEqual(['t-9']);
  // a sig for another file, or an unknown one, patches nothing: the reload then refetches
  act(() => { w.hook.result.current.f.patchSig({ path: 'src/b.ts', sig: 'zzz' }); w.hook.result.current.f.patchSig({ path: 'src/a.ts', sig: null }); });
  w.sigs['src/a.ts'] = 'a3';
  await w.reload(); await w.settle();
  expect(w.diffs()).toBe(2);
});
