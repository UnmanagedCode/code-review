import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, test } from 'vitest';
import { navigate } from '@/lib/route';
import type { DiffFile, DiffLine, Side } from '@/lib/types';
import { WIDE_QUERY } from '@/lib/useMediaQuery';
import { useFileDiff } from '@/state/fileDiff';
import { ReviewProvider, type ReviewCtx } from '@/state/reviewContext';
import { installMedia } from '@/test/fakeMedia';
import { installResizeObserver } from '@/test/fakeResizeObserver';
import { diffFile, fileState, hunk, review, thread, linesAnchor } from '@/test/fixtures';
import { ctxValue } from '@/test/renderCtx';
import { stubFetch } from '@/test/stubFetch';
import { FileDiff } from './FileDiff';

let ro: ReturnType<typeof installResizeObserver>;
beforeEach(() => {
  installMedia({ [WIDE_QUERY]: true });
  ro = installResizeObserver();
  history.replaceState(null, '', '?file=src%2Fa.ts');
});

const L = (t: DiffLine['t'], old: number | null, nu: number | null, text: string): DiffLine => ({ t, old, new: nu, text });
// hw (3–7): only a re-indent. hm (20–27): a re-indent (23) and a real change (24).
const hw = hunk({ id: 'hw', header: '@@ -3,5 +3,5 @@', oldStart: 3, oldLines: 5, newStart: 3, newLines: 5, lines: [L('ctx', 3, 3, 'a3'), L('ctx', 4, 4, 'a4'), L('del', 5, null, 'if (x) {'), L('add', null, 5, '  if (x) {'), L('ctx', 6, 6, 'a6'), L('ctx', 7, 7, 'a7')] });
const hm = hunk({
  id: 'hm', header: '@@ -20,8 +20,8 @@', oldStart: 20, oldLines: 8, newStart: 20, newLines: 8,
  lines: [L('ctx', 20, 20, 'b20'), L('ctx', 21, 21, 'b21'), L('ctx', 22, 22, 'b22'), L('del', 23, null, 'let y = 1;'), L('del', 24, null, 'foo();'), L('add', null, 23, '  let y = 1;'), L('add', null, 24, 'bar();'), L('ctx', 25, 25, 'b25'), L('ctx', 26, 26, 'b26'), L('ctx', 27, 27, 'b27')],
});
const fileLines = (u: URL) => {
  const [s, e] = [Number(u.searchParams.get('start')), Number(u.searchParams.get('end'))];
  return { path: 'src/a.ts', side: 'new', total: 40, lines: Array.from({ length: e - s + 1 }, (_, i) => ({ n: s + i, text: `L${s + i}` })) };
};

/** FileDiff over the real useFileDiff, so the Diff options run through the same transforms as in the app. */
function Live({ over }: { over: Partial<ReviewCtx> }) {
  const fileDiff = useFileDiff({ reviewId: 'r-1', path: 'src/a.ts', uncommitted: false, round: over.round });
  return <ReviewProvider value={ctxValue({ files: [fileState()], ...over, fileDiff })}><FileDiff /></ReviewProvider>;
}
const show = async (file: DiffFile = diffFile({ hunks: [hw, hm], lineCount: { old: 40, new: 40 } }), over: Partial<ReviewCtx> = {}, view: 'inline' | 'split' = 'inline') => {
  localStorage.setItem('code-review:diffView', view);
  const net = stubFetch({
    'GET api/reviews/r-1/diff': { review: review(), files: [file] },
    'GET api/reviews/r-1/file': fileLines,
    'PUT api/reviews/r-1/hunks/hw/verdict': { hunkId: 'hw', verdict: 'accepted', review: review({ rev: 2 }), fileSig: { path: 'src/a.ts', sig: 's-2' } },
  });
  render(<Live over={over} />);
  ro.resize('all', 1000);
  await screen.findByRole('grid');
  return net;
};
const user = () => userEvent.setup();
const options = () => screen.getByRole('button', { name: /^Diff options/ });
const pick = async (item: 'Ignore whitespace' | string) => {
  const u = user();
  await u.click(options());
  await u.click(await screen.findByRole(item === 'Ignore whitespace' ? 'menuitemcheckbox' : 'menuitemradio', { name: item }));
};
const cell = (side: Side, n: number) => document.querySelector<HTMLElement>(`[data-cell="${side}:${n}"]`);
const rowOf = (side: Side, n: number) => cell(side, n)?.closest('[role="row"]') ?? null;
const summary = () => screen.queryByRole('button', { name: /@@ -3,5 \+3,5 @@.*whitespace only/ });
const cardsUnder = (row: Element) => {
  const rows = screen.getAllByRole('row');
  const next = rows[rows.indexOf(row as HTMLElement) + 1];
  return screen.getAllByRole('article').filter((a) => (row.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING)
    && (!next || next.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_PRECEDING));
};

// Invariant: Ignore whitespace collapses a whitespace-only hunk to a badged summary that keeps its id and verdict bar.
test('a whitespace-only hunk becomes a "whitespace only" summary; expanded, Accept sends its original id', async () => {
  const net = await show();
  expect(summary()).toBeNull();
  await pick('Ignore whitespace');
  expect(summary()?.getAttribute('aria-expanded')).toBe('false');
  expect(cell('new', 5)).toBeNull();
  await user().click(summary()!);
  expect(rowOf('new', 5)).toBe(rowOf('old', 5));
  await user().click(within(screen.getAllByRole('group', { name: 'Hunk verdict' })[0]).getByRole('button', { name: 'Accept' }));
  await waitFor(() => expect(net.calls.find((c) => c.method === 'PUT')?.url.pathname).toBe('/api/reviews/r-1/hunks/hw/verdict'));
});

// Invariant: a re-indented pair in a mixed hunk shows as one row with both numbers; the real change stays a change; turning it off restores git's lines.
test('a mixed hunk shows the merged row, and toggling off restores the original lines', async () => {
  await show();
  await pick('Ignore whitespace');
  expect(rowOf('old', 23)).toBe(rowOf('new', 23));
  expect(rowOf('old', 23)?.textContent).toContain('  let y = 1;');
  expect(rowOf('old', 24)).not.toBe(rowOf('new', 24));
  await pick('Ignore whitespace');
  expect(rowOf('old', 23)).not.toBe(rowOf('new', 23));
  expect(rowOf('old', 23)?.textContent).toContain('let y = 1;');
  expect(summary()).toBeNull();
});

describe.each(['inline', 'split'] as const)('%s', (view) => {
  // Invariant: a thread keyed on a merged row's old line still renders under that row.
  test('a thread on a merged row\'s old line stays under that row', async () => {
    const t = thread({ anchor: linesAnchor({ side: 'old', startLine: 23, endLine: 23, hunkId: 'hm' }) });
    await show(diffFile({ hunks: [hw, hm], threads: [t], lineCount: { old: 40, new: 40 } }), {}, view);
    await pick('Ignore whitespace');
    const row = rowOf('old', 23)!;
    expect(rowOf('new', 23)).toBe(row);
    expect(cardsUnder(row).map((c) => c.getAttribute('aria-label'))).toEqual(['comment thread']);
  });
});

// Invariant: the options are view-only: a selection made before a change survives it.
test('a selection survives toggling Ignore whitespace', async () => {
  await show();
  const start = cell('new', 23)!;
  start.focus();
  const u = user();
  await u.keyboard('{Enter}');
  await u.keyboard('{Shift>}{ArrowDown}{/Shift}');
  expect(screen.getByRole('toolbar', { name: 'Selection' }).textContent).toContain('L23–L24 (new)');
  await pick('Ignore whitespace');
  expect(screen.getByRole('toolbar', { name: 'Selection' }).textContent).toContain('L23–L24 (new)');
});

// Invariant: a whitespace-only hunk holding the routed thread is never collapsed.
test('a whitespace-only hunk holding the routed thread stays expanded', async () => {
  const t = thread({ id: 't-9', anchor: linesAnchor({ side: 'new', startLine: 5, endLine: 5, hunkId: 'hw' }) });
  navigate({ file: 'src/a.ts', thread: 't-9' });
  await show(diffFile({ hunks: [hw, hm], threads: [t], lineCount: { old: 40, new: 40 } }));
  await pick('Ignore whitespace');
  expect(summary()).toBeNull();
  expect(cell('new', 5)).not.toBeNull();
});

// Invariant: the automatic whitespace collapse never hides an open conversation; a resolved one does not hold it open.
test.each([['open', false], ['resolved', true]] as const)('a whitespace-only hunk holding an %s thread collapses=%s', async (status, collapses) => {
  const t = thread({ id: 't-5', status, anchor: linesAnchor({ side: 'new', startLine: 5, endLine: 5, hunkId: 'hw' }) });
  await show(diffFile({ hunks: [hw, hm], threads: [t], lineCount: { old: 40, new: 40 } }));
  await pick('Ignore whitespace');
  expect(!!summary()).toBe(collapses);
  expect(!!cell('new', 5)).toBe(!collapses);
});

// Invariant: fewer context lines move hunk-edge context into gaps, but a thread's lines are reopened.
test('context 0 puts edge context in gaps, and a thread on a trimmed line re-opens its gap', async () => {
  const t = thread({ anchor: linesAnchor({ side: 'new', startLine: 21, endLine: 21, hunkId: 'hm' }) });
  await show(diffFile({ hunks: [hw, hm], threads: [t], lineCount: { old: 40, new: 40 } }));
  expect(cell('new', 3)).not.toBeNull();
  await pick('0');
  expect(cell('new', 3)).toBeNull();
  expect(cell('new', 4)).toBeNull();
  await waitFor(() => expect(cell('new', 21)).not.toBeNull());
  expect(cell('new', 20)).toBeNull();
  expect(rowOf('new', 21)?.textContent).toContain('b21');
});

// Invariant: the options are display-only, so read-only views offer them too.
test('the menu is present in a past-round view', async () => {
  await show(undefined, { round: 1, readOnly: true });
  expect(options()).toBeTruthy();
});

// Invariant: the trigger's accessible name says which settings differ from the default.
test('the trigger\'s name lists the non-default settings', async () => {
  await show();
  expect(options().getAttribute('aria-label')).toBe('Diff options');
  await pick('Ignore whitespace');
  await pick('10');
  expect(options().getAttribute('aria-label')).toBe('Diff options · ignoring whitespace · 10 context lines');
});
