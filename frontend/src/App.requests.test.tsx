import { act, render } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { navigateTo } from '@/lib/route';
import { FakeEventSource } from '@/test/fakeEventSource';
import { setEventSourceFactory } from '@/lib/sse';
import { diffFile, fileState, review } from '@/test/fixtures';
import { stubFetch } from '@/test/stubFetch';
import { App } from './App';

const ENDPOINTS = {
  projects: 'GET api/projects',
  checkout: 'GET api/checkout',
  reviews: 'GET api/reviews',
  sessions: 'GET api/sessions',
  review: 'GET api/reviews/r-1',
  diff: 'GET api/reviews/r-1/diff',
  file: 'GET api/reviews/r-1/file',
} as const;
type Counts = Partial<Record<keyof typeof ENDPOINTS | 'eventSource', number>>;

let visibility: DocumentVisibilityState = 'visible';
afterEach(() => { visibility = 'visible'; Reflect.deleteProperty(document, 'visibilityState'); });

// Invariant: a scripted list → review → files → list → review session stays within its request budget: one event stream
// and one projects fetch; revisits within MAX_AGE_MS cost nothing; an event refetches the review but only the file whose
// sig moved; a hidden tab refetches nothing until it is visible.
test('request budget across a list ↔ review session', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  let eventSources = 0;
  const sources: FakeEventSource[] = [];
  setEventSourceFactory(() => { eventSources++; const s = new FakeEventSource(); sources.push(s); return s as unknown as EventSource; });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });

  const sig = { 'a.ts': 'a1', 'b.ts': 'b1' } as Record<string, string>;
  let rev = 1;
  const files = () => ['a.ts', 'b.ts'].map((path) => ({ ...fileState({ path }), sig: sig[path] }));
  const net = stubFetch([
    [/^GET api\/projects$/, { projects: [{ name: 'app' }] }],
    [/^GET api\/checkout\?/, { checkout: { project: 'app', worktree: null, path: '/x', branch: 'main', headSha: 'h', dirty: false, exists: true }, forkPoints: [], worktrees: [] }],
    [/^GET api\/sessions\/[^/?]+\/places$/, { places: [] }],
    [/^GET api\/sessions/, { sessions: [] }],
    [/^GET api\/reviews\?/, () => ({ reviews: [review({ id: 'r-1', worktree: null, rev }), review({ id: 'r-2', worktree: null, rev: 1 })] })],
    [/^GET api\/inbox$/, { reviews: [] }],
    [/^GET api\/reviews\/r-1$/, () => ({ review: review({ worktree: null, rev }), files: files(), rounds: [], submissions: [], outdatedThreads: [], reviewThreads: [] })],
    [/^GET api\/reviews\/r-1\/diff/, (u: URL) => {
      const path = u.searchParams.get('file')!;
      return { review: review({ worktree: null, rev }), files: [{ ...diffFile({ path }), sig: sig[path], lineCount: { old: 40, new: 40 } }] };
    }],
    [/^GET api\/reviews\/r-1\/file/, { path: 'a.ts', side: 'new', total: 40, lines: [] }],
  ]);

  const seen: Counts = {};
  const step = async (action: () => void | Promise<void>): Promise<Counts> => {
    await act(async () => { await action(); await vi.advanceTimersByTimeAsync(400); });
    const out: Counts = {};
    for (const [k, key] of Object.entries(ENDPOINTS)) {
      const n = net.calls.filter((c) => `${c.method} ${c.url.pathname.replace(/^\//, '')}` === key).length;
      out[k as keyof typeof ENDPOINTS] = n - (seen[k as keyof typeof ENDPOINTS] ?? 0);
      seen[k as keyof typeof ENDPOINTS] = n;
    }
    out.eventSource = eventSources - (seen.eventSource ?? 0);
    seen.eventSource = eventSources;
    return Object.fromEntries(Object.entries(out).filter(([, n]) => n)) as Counts;
  };
  const go = (route: Parameters<typeof navigateTo>[0]) => () => navigateTo({ project: 'app', ...route });
  const measured: Record<string, Counts> = {};

  history.replaceState(null, '', '?project=app');
  measured['1 open ?project=app'] = await step(() => { render(<App />); });
  measured['2 open r-1, file a'] = await step(go({ review: 'r-1', file: 'a.ts' }));
  measured['3 switch to file b'] = await step(go({ review: 'r-1', file: 'b.ts' }));
  measured['4 back to file a'] = await step(go({ review: 'r-1', file: 'a.ts' }));
  measured['5 back to the list'] = await step(go({}));
  measured['6 reopen r-1'] = await step(go({ review: 'r-1', file: 'a.ts' }));
  sig['b.ts'] = 'b2'; rev = 2;
  measured['7 event r-1, only b moved'] = await step(() => sources[0].emit({ id: 'r-1', rev: 2 }));
  measured['7b back to the list'] = await step(go({}));
  measured['8a hidden, event r-2'] = await step(() => { visibility = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); sources[0].emit({ id: 'r-2', rev: 2 }); });
  visibility = 'visible';
  measured['8b visible again'] = await step(() => { document.dispatchEvent(new Event('visibilitychange')); });
  expect(measured).toEqual({
    '1 open ?project=app': { projects: 1, checkout: 1, reviews: 1, sessions: 1, eventSource: 1 },
    '2 open r-1, file a': { review: 1, diff: 1 },
    '3 switch to file b': { diff: 1 },
    '4 back to file a': {},
    '5 back to the list': {},
    '6 reopen r-1': {},
    '7 event r-1, only b moved': { review: 1 },
    '7b back to the list': { reviews: 1 },
    '8a hidden, event r-2': {},
    '8b visible again': { reviews: 1 },
  });
  expect(eventSources).toBe(1);
});
