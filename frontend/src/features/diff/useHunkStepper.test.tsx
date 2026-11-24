import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { navigate } from '@/lib/route';
import { parseRoute } from '@/lib/route';
import { WIDE_QUERY } from '@/lib/useMediaQuery';
import { installMedia } from '@/test/fakeMedia';
import { buildRows } from '@/lib/diffRows';
import type { FileDiffState } from '@/state/fileDiff';
import { diffFile, fileState, guideGroup, guideView, hunk, lines, message, review, thread, linesAnchor } from '@/test/fixtures';
import { renderDiff, renderInReview } from '@/test/renderCtx';
import { stubFetch } from '@/test/stubFetch';
import { FileDiff } from './FileDiff';
import { hunkAt, nextHunk, prevHunk, stepTarget } from './useHunkStepper';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
type ToastArgs = [string, { action?: { label: string; onClick: () => void } }?];
const toasts = () => vi.mocked(toast as unknown as (...a: unknown[]) => void).mock.calls as unknown as ToastArgs[];

const ok = (verdict: string) => ({ hunkId: 'h1', verdict, clearedGroups: [], review: review({ rev: 2 }), fileSig: { path: 'src/a.ts', sig: 's-2' } });
const H = (id: string, start: number, over = {}) => hunk({ id, header: `@@ -${start} +${start} @@ ${id}`, oldStart: start, newStart: start, lines: lines('c1 d2 a2'), ...over });
const file3 = (verdicts: (string | null)[] = [null, null, null]) => diffFile({
  path: 'src/a.ts', hunks: [H('h1', 1, { verdict: verdicts[0] }), H('h2', 20, { verdict: verdicts[1] }), H('h3', 40, { verdict: verdicts[2] })] as never,
});
const route = () => parseRoute(location.search);

// Tops the stubbed layout reports per hunk id; the sticky header's bottom edge is HEADER.
const HEADER = 100;
let tops: Record<string, number> = {};
const spy = () => vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
  const id = (this as HTMLElement).dataset?.hunkId;
  const top = id ? tops[id] ?? 0 : 0;
  const bottom = id ? top + 50 : this.classList.contains('sticky') ? HEADER : 0;
  return { top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
});
const active = () => (document.activeElement as HTMLElement | null)?.dataset.hunkId;
const mount = (url: string, f = file3(), over = {}) => {
  history.replaceState(null, '', url);
  return renderDiff(<FileDiff />, f, over);
};
const keys = (k: string) => userEvent.setup().keyboard(k);

beforeEach(() => {
  installMedia({ [WIDE_QUERY]: true });
  tops = { h1: HEADER, h2: 500, h3: 900 };
  spy();
  // Scrolling a hunk to the top shifts every hunk by the distance it moved.
  Element.prototype.scrollIntoView = function (this: Element) {
    const shift = (tops[(this as HTMLElement).dataset.hunkId ?? ''] ?? HEADER) - HEADER;
    tops = Object.fromEntries(Object.entries(tops).map(([k, v]) => [k, v - shift]));
  };
  vi.mocked(toast as unknown as (...a: unknown[]) => void).mockClear();
});
afterEach(() => { vi.restoreAllMocks(); delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView; });

// Invariant: the geometry rules: the current hunk is the last at or above the header edge (2px slack); next is the first wholly below; previous is the last starting above, so mid-hunk it is the hunk's own start.
test('hunkAt, nextHunk and prevHunk read the tops against the header edge', () => {
  expect(hunkAt([100, 500, 900], 100)).toBe(0);
  expect(hunkAt([-300, -50, 400], 100)).toBe(1);
  expect(hunkAt([98, 500], 100)).toBe(0);
  expect(hunkAt([101, 500], 100)).toBe(0);
  expect(nextHunk([100, 500, 900], 100)).toBe(1);
  expect(nextHunk([102, 500], 100)).toBe(1);
  expect(nextHunk([100, 500], 600)).toBe(-1);
  expect(prevHunk([-300, -50, 400], 100)).toBe(1);
  expect(prevHunk([100, 500], 100)).toBe(-1);
  expect(prevHunk([-300, 100, 500], 100)).toBe(0);
});

// Invariant: with a hunk focused a step moves by index, one hunk at a time, never back over hunks the page could not scroll to the header; with none focused it reads the geometry.
test('stepTarget steps by the focused hunk and clamps; k returns to a scrolled-past hunk first', () => {
  const fits = [150, 400, 700]; // every hunk already below the header: nothing can scroll
  expect(stepTarget(fits, 100, -1, 1)).toBe(0);
  expect(stepTarget(fits, 100, 0, 1)).toBe(1);
  expect(stepTarget(fits, 100, 2, 1)).toBe(-1);
  expect(stepTarget(fits, 100, 2, -1)).toBe(1);
  expect(stepTarget(fits, 100, 0, -1)).toBe(-1);
  expect(stepTarget([-300, -50, 400], 100, 1, -1)).toBe(1);
  expect(stepTarget([-300, 100, 400], 100, 1, -1)).toBe(0);
});

// Invariant: when every hunk fits the viewport (nothing scrolls), j walks 1 → 2 → 3 and stops, k walks back and stops, and the chevrons disable at the ends.
test('j and k step through hunks of a file that fits the viewport without bouncing', async () => {
  Element.prototype.scrollIntoView = () => {};
  tops = { h1: 150, h2: 400, h3: 700 };
  mount('?file=src/a.ts');
  const label = () => (document.activeElement as HTMLElement).getAttribute('aria-label')!.split(':')[0];
  const next = () => screen.getByRole('button', { name: 'Next hunk' }) as HTMLButtonElement;
  const prev = () => screen.getByRole('button', { name: 'Previous hunk' }) as HTMLButtonElement;
  for (const want of ['Hunk 1 of 3', 'Hunk 2 of 3', 'Hunk 3 of 3', 'Hunk 3 of 3']) { await keys('j'); expect(label()).toBe(want); }
  await waitFor(() => expect(next().disabled).toBe(true));
  expect(prev().disabled).toBe(false);
  for (const want of ['Hunk 2 of 3', 'Hunk 1 of 3', 'Hunk 1 of 3']) { await keys('k'); expect(label()).toBe(want); }
  await waitFor(() => expect(prev().disabled).toBe(true));
  expect(next().disabled).toBe(false);
});

// Invariant: j focuses the hunk region (not its Accept button) below the sticky header, k from the middle of a hunk returns to that hunk's start, and neither wraps.
test('j focuses the first hunk below the sticky header; k from mid-hunk returns to its start; neither wraps', async () => {
  mount('?file=src/a.ts');
  expect(screen.getByText('Hunk 1 of 3')).toBeTruthy();
  await keys('j');
  expect(active()).toBe('h2');
  expect((document.activeElement as HTMLElement).getAttribute('aria-label')).toMatch(/^Hunk 2 of 3: /);
  await keys('j');
  expect(active()).toBe('h3');
  await keys('j');
  expect(active()).toBe('h3');
  // Scrolled into the middle of h2: k lands on h2's start, then h1.
  tops = { h1: -300, h2: -50, h3: 400 };
  await keys('k');
  expect(active()).toBe('h2');
  tops = { h1: -300, h2: HEADER, h3: 400 };
  await keys('k');
  expect(active()).toBe('h1');
  tops = { h1: HEADER, h2: 500, h3: 900 };
  await keys('k');
  expect(active()).toBe('h1');
});

// Invariant: the position follows the scroll without any step.
test('Hunk k of N follows the scroll position', async () => {
  mount('?file=src/a.ts');
  tops = { h1: -900, h2: -400, h3: 98 };
  await act(async () => { window.dispatchEvent(new Event('scroll')); await new Promise((r) => requestAnimationFrame(() => r(null))); });
  await waitFor(() => expect(screen.getByText('Hunk 3 of 3')).toBeTruthy());
});

// Invariant: a hunk beyond the rendered row window is reached by widening the window, and is then focused.
test('a hunk beyond the row window widens the window, then is focused', async () => {
  const big = hunk({ id: 'h1', header: '@@ big @@', lines: Array.from({ length: 1600 }, (_, i) => ({ t: 'add' as const, old: null, new: i + 1, text: `l${i}` })), oldStart: 1, newStart: 1, oldLines: 0, newLines: 1600 });
  mount('?file=src/a.ts', diffFile({ path: 'src/a.ts', hunks: [big, H('h2', 2000)] as never }));
  expect(document.querySelector('[data-hunk-id="h2"]')).toBeNull();
  await keys('j');
  await waitFor(() => expect(active()).toBe('h2'));
});

// Invariant: hunk=undecided lands on the file's first pending hunk, once; a routed thread or lines win and leave focus alone.
test('hunk=undecided focuses the first pending hunk once; a routed thread or lines wins', async () => {
  const view = mount('?file=src/a.ts&hunk=undecided', file3(['accepted', null, null]));
  await waitFor(() => expect(active()).toBe('h2'));
  (document.activeElement as HTMLElement).blur();
  // The landing is once per arrival: a later route change on the same file does not land again.
  act(() => navigate({ lines: '2' }));
  act(() => navigate({ lines: undefined }));
  expect(active()).toBeUndefined();
  view.unmount();
  const t = thread({ id: 't-1', anchor: linesAnchor({ file: 'src/a.ts', startLine: 2, endLine: 2, hunkId: 'h1' }), messages: [message()] });
  for (const url of ['?file=src/a.ts&hunk=undecided&thread=t-1', '?file=src/a.ts&hunk=undecided&lines=2']) {
    const r = mount(url, diffFile({ path: 'src/a.ts', hunks: file3([null, null, null]).hunks, threads: [t] }));
    await new Promise((res) => setTimeout(res, 20));
    expect(active(), url).toBeUndefined();
    r.unmount();
  }
});

// Invariant: a, x and 0 write accepted, rejected and pending for the hunk that holds keyboard focus, and only that hunk; with no hunk focused they do nothing.
test.each([['a', null, 'accepted'], ['x', null, 'rejected'], ['0', 'accepted', 'pending']] as const)('%s decides the focused hunk and nothing else', async (key, before, verdict) => {
  const net = stubFetch({ [`PUT api/reviews/r-1/hunks/${before ? 'h1' : 'h2'}/verdict`]: ok(verdict) });
  mount('?file=src/a.ts', file3(before ? [before, null, null] : [null, null, null]));
  await keys(key);
  expect(net.calls).toEqual([]);
  if (!before) await keys('j'); else document.querySelector<HTMLElement>('[data-hunk-id="h1"]')!.focus();
  await keys(key);
  await waitFor(() => expect(net.calls).toHaveLength(1));
  expect(net.calls[0].body).toEqual({ verdict });
  expect(net.calls[0].url.pathname).toBe(`/api/reviews/r-1/hunks/${before ? 'h1' : 'h2'}/verdict`);
});

// Invariant: focus inside a thread card never decides a hunk: after n the card holds focus, and a letter meant for its reply box must not act.
test('a/x/0 ignore focus inside a thread card', async () => {
  const net = stubFetch({});
  const t = thread({ id: 't-1', anchor: linesAnchor({ file: 'src/a.ts', startLine: 2, endLine: 2, hunkId: 'h1' }), messages: [message()] });
  mount('?file=src/a.ts', diffFile({ path: 'src/a.ts', hunks: file3().hunks, threads: [t] }));
  const card = screen.getAllByRole('article')[0];
  card.focus();
  expect(document.activeElement).toBe(card);
  await keys('ax0');
  expect(net.calls).toEqual([]);
});

// Invariant: a key verdict that would contradict its group's decided verdict is refused with an explanation (it would silently clear the group): nothing is written.
test('a key verdict that contradicts its group verdict is refused and writes nothing', async () => {
  const net = stubFetch({});
  const guide = guideView({ groups: [guideGroup({ id: 'g1', title: 'Auth', verdict: 'accepted', hunks: [{ id: 'h2', file: 'src/a.ts', verdict: 'accepted' }] })] });
  mount('?file=src/a.ts', file3(), { guide });
  await keys('j');
  expect(active()).toBe('h2');
  await keys('x');
  expect(toasts().map((c) => c[0])).toEqual(['Part of “Auth”, which is accepted — change it from the hunk bar or the Guided tab']);
  expect(net.calls).toEqual([]);
  // The same verdict as the group's is no contradiction.
  const ok2 = stubFetch({ 'PUT api/reviews/r-1/hunks/h2/verdict': ok('accepted') });
  await keys('a');
  await waitFor(() => expect(ok2.calls).toHaveLength(1));
});

// Invariant: every applied key verdict offers Undo, which writes the verdict the hunk had.
test('Undo restores the previous verdict', async () => {
  const net = stubFetch({ 'PUT api/reviews/r-1/hunks/h2/verdict': ok('accepted') });
  mount('?file=src/a.ts', file3([null, 'rejected', null]));
  await keys('j');
  await keys('a');
  await waitFor(() => expect(net.calls).toHaveLength(1));
  expect(net.calls[0].body).toEqual({ verdict: 'accepted' });
  const [text, opts] = toasts().at(-1)!;
  expect(text).toBe('Hunk accepted');
  expect(opts?.action?.label).toBe('Undo');
  await act(async () => { opts!.action!.onClick(); });
  await waitFor(() => expect(net.calls).toHaveLength(2));
  expect(net.calls[1].body).toEqual({ verdict: 'rejected' });
});

// Invariant: the verdict keys are unregistered wherever writes are off or verdicts don't apply.
test.each([
  ['a closed review', { readOnly: true, review: review({ status: 'closed' }) }],
  ['an uncommitted review', { review: review({ kind: 'uncommitted' }) }],
  ['a past round', { round: 1, readOnly: true }],
  ['the commit filter', { commit: 'abc1234', readOnly: true }],
])('verdict keys do nothing on %s', async (_, over) => {
  const net = stubFetch({});
  mount('?file=src/a.ts', file3(), over);
  await keys('j');
  expect(active()).toBe('h2');
  await keys('ax0');
  expect(net.calls.filter((c) => c.method === 'PUT')).toEqual([]);
});
