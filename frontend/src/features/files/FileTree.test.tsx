import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { toast } from 'sonner';
import { afterEach, expect, test, vi } from 'vitest';
import { treeOrder } from '@/lib/fileTree';
import { resetFileFilters } from '@/state/fileFilter';
import { useReviewActions } from '@/state/threads';
import { fileState, refusal, review, threadDigest } from '@/test/fixtures';
import { ctxValue, renderInReview } from '@/test/renderCtx';
import { ReviewProvider } from '@/test/reviewProvider';
import { stubFetch } from '@/test/stubFetch';
import type { FileState } from '@/lib/types';
import { FileTree } from './FileTree';

afterEach(resetFileFilters);
const tree = (files: FileState[], over = {}, selected?: string) => renderInReview(<FileTree files={files} selected={selected} />, { files, ...over });
const link = (re: RegExp) => screen.getByRole('link', { name: re });

// Invariant: a row's hunk pips, thread bubble and unread dot are readable by role and name (the tally, "N open threads, M need you", unread), and +/− sit in the link's title.
test('rows expose the verdict tally, open threads, hunk counts and unread as accessible names', () => {
  tree([
    fileState({ path: 'src/a.ts', hunks: 6, verdicts: { pending: 2, accepted: 1, rejected: 3 }, threads: { open: 4, resolved: 5, outdated: 6 }, unread: 2 }),
    fileState({ path: 'b.ts', verdicts: null, hunks: 3 }),
  ], { openThreads: [threadDigest({ id: 't-1', state: 'awaiting-human', anchor: { kind: 'file', file: 'src/a.ts', round: 1 } })] }, 'src/a.ts');
  const a = within(link(/a\.ts/));
  expect(a.getByRole('img', { name: '1 accepted, 3 rejected, 2 undecided' })).toBeTruthy();
  expect(a.getByRole('img', { name: '4 open threads, 1 needs you' })).toBeTruthy();
  expect(link(/a\.ts/).getAttribute('aria-current')).toBe('true');
  expect(link(/a\.ts/).getAttribute('title')).toContain('+2 −1');
  expect(within(link(/b\.ts/)).getByText('3 hunks')).toBeTruthy();
});

// Invariant: a file link carries the file in its query and nests under its directory.
test('a file link carries the file in its query and nests under its directory', () => {
  tree([fileState({ path: 'src/lib/c.ts' })]);
  expect(screen.getByText('src/')).toBeTruthy();
  expect(link(/c\.ts/).getAttribute('href')).toBe('?file=src%2Flib%2Fc.ts');
});

// Invariant: the viewed checkbox is a sibling of the link (no control inside a link) and sends the hunk ids the row shows.
test('the viewed checkbox sends the shown hunk ids, flips at once and reverts on a refusal', async () => {
  vi.spyOn(toast, 'error').mockImplementation(() => '');
  const files = [fileState({ path: 'a.ts', hunkIds: ['h1', 'h2'], hunks: 2, verdicts: { pending: 2, accepted: 0, rejected: 0 } })];
  let refuse!: () => void;
  const answer = new Promise<Response>((r) => { refuse = () => r(refusal('STALE_HUNKS')); });
  const net = stubFetch({ 'PUT api/reviews/r-1/files/viewed': () => answer });
  function Harness() {
    const [fs, setFs] = useState(files);
    const value = ctxValue({ files: fs, patchFiles: (fn) => setFs(fn) });
    return <ReviewProvider value={value}><FileTree files={fs} selected={undefined} /></ReviewProvider>;
  }
  render(<Harness />);
  const box = screen.getByRole('checkbox', { name: 'Viewed a.ts' }) as HTMLInputElement;
  expect(box.closest('a')).toBeNull();
  await userEvent.setup().click(box);
  expect((screen.getByRole('checkbox', { name: 'Viewed a.ts' }) as HTMLInputElement).checked).toBe(true);
  await waitFor(() => expect(net.calls[0].body).toEqual({ file: 'a.ts', hunkIds: ['h1', 'h2'] }));
  await act(async () => refuse());
  await waitFor(() => expect((screen.getByRole('checkbox', { name: 'Viewed a.ts' }) as HTMLInputElement).checked).toBe(false));
});

// Invariant: unchecking sends null (clears the mark) and, on success, patches the file's sig and reloads.
test('unchecking clears the mark with null and folds in the answer', async () => {
  const net = stubFetch({ 'PUT api/reviews/r-1/files/viewed': { file: 'a.ts', viewed: false, review: review({ rev: 2 }), fileSig: { path: 'a.ts', sig: 's-9' } } });
  const { value } = tree([fileState({ path: 'a.ts', viewed: true })]);
  await userEvent.setup().click(screen.getByRole('checkbox', { name: 'Viewed a.ts' }));
  await waitFor(() => expect(net.calls[0].body).toEqual({ file: 'a.ts', hunkIds: null }));
  await waitFor(() => expect(value.diffs.patchSig).toHaveBeenCalledWith({ path: 'a.ts', sig: 's-9' }));
  expect(value.reload).toHaveBeenCalled();
});

// Invariant: a read-only view offers no viewed checkboxes.
test('read-only hides the checkboxes', () => {
  tree([fileState({ path: 'a.ts' })], { readOnly: true });
  expect(screen.queryByRole('checkbox')).toBeNull();
});

const FILES = [
  fileState({ path: 'src/alpha.ts', verdicts: { pending: 1, accepted: 0, rejected: 0 } }),
  fileState({ path: 'src/Beta.ts', verdicts: { pending: 0, accepted: 1, rejected: 0 } }),
  fileState({ path: 'docs/readme.md', verdicts: { pending: 2, accepted: 0, rejected: 0 } }),
  fileState({ path: 'lib/gamma.ts', verdicts: { pending: 0, accepted: 1, rejected: 0 } }),
];
const NEEDS = [threadDigest({ id: 't-1', state: 'awaiting-human', anchor: { kind: 'file', file: 'src/Beta.ts', round: 1 } })];
const hrefs = () => screen.getAllByRole('link').map((l) => l.getAttribute('href'));

// Invariant: the text filter is a case-insensitive substring of the path; a summary says how many are shown; Clear filter restores all.
test('the text filter narrows by path, says how many show, and clears', async () => {
  tree(FILES, { openThreads: NEEDS });
  const user = userEvent.setup();
  await user.type(screen.getByRole('searchbox', { name: 'Filter files' }), 'BETA');
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByText(/Showing 1 of 4 files/)).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Clear filter' }));
  expect(screen.getAllByRole('link')).toHaveLength(4);
  expect(screen.queryByText(/Showing/)).toBeNull();
});

// Invariant: Needs me counts the files holding an open thread that waits on the human (from the digests); Undecided counts files with a pending hunk; both on keep a file matching either; the text applies on top.
test('Needs me and Undecided toggles count, OR together, and sit under the text filter', async () => {
  tree(FILES, { openThreads: NEEDS });
  const user = userEvent.setup();
  const needs = screen.getByRole('button', { name: 'Needs me 1' });
  const undecided = screen.getByRole('button', { name: 'Undecided 2' });
  await user.click(needs);
  expect(needs.getAttribute('aria-pressed')).toBe('true');
  expect(screen.getAllByRole('link')).toHaveLength(1);
  await user.click(undecided);
  expect(screen.getAllByRole('link')).toHaveLength(3);
  await user.type(screen.getByRole('searchbox', { name: 'Filter files' }), 'src/');
  expect(hrefs()).toEqual(['?file=src%2Falpha.ts', '?file=src%2FBeta.ts']);
  expect(screen.getByText(/Showing 2 of 4 files/)).toBeTruthy();
});

// Invariant: an uncommitted review has no verdicts, so no Undecided toggle; a past view has no filter toggles or progress.
test('Undecided is absent on uncommitted reviews and the toggles on past views', () => {
  const { unmount } = tree([fileState({ path: 'a.ts', verdicts: null })], { review: review({ kind: 'uncommitted' }) });
  expect(screen.getByRole('button', { name: /Needs me/ })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Undecided/ })).toBeNull();
  unmount();
  tree([fileState({ path: 'a.ts' })], { round: 1, readOnly: true });
  expect(screen.queryByRole('button', { name: /Needs me/ })).toBeNull();
  expect(screen.getByRole('searchbox', { name: 'Filter files' })).toBeTruthy();
});

// Invariant: the viewed progress counts the marked files of the view.
test('shows X of Y viewed', () => {
  tree([fileState({ path: 'a.ts', viewed: true }), fileState({ path: 'b.ts' }), fileState({ path: 'c.ts', viewed: true })]);
  expect(screen.getByText('2 of 3 viewed')).toBeTruthy();
});

// Invariant: the filter lives outside the component, so it survives the tree unmounting (a phone's file round trip) for the same review.
test('the filter survives an unmount and remount for the same review', async () => {
  const first = tree(FILES);
  await userEvent.setup().type(screen.getByRole('searchbox', { name: 'Filter files' }), 'gamma');
  first.unmount();
  tree(FILES);
  expect((screen.getByRole('searchbox', { name: 'Filter files' }) as HTMLInputElement).value).toBe('gamma');
  expect(screen.getAllByRole('link')).toHaveLength(1);
});

// Invariant: the rows follow treeOrder (directories first, then name), filtered or not.
test('rows are in treeOrder with and without a filter', async () => {
  const files = [fileState({ path: 'z.ts' }), fileState({ path: 'b/y.ts' }), fileState({ path: 'a.ts' }), fileState({ path: 'b/x.ts' })];
  tree(files);
  const order = () => screen.getAllByRole('link').map((l) => l.getAttribute('href'));
  const expected = treeOrder(files).map((f) => `?file=${encodeURIComponent(f.path)}`);
  expect(order()).toEqual(expected);
  await userEvent.setup().type(screen.getByRole('searchbox', { name: 'Filter files' }), 'y');
  await act(async () => {});
  expect(order()).toEqual(expected.filter((h) => /y/.test(h)));
});

// Invariant: a file with more hunks than there are pips shows the proportional bar, with the same accessible tally.
test('many hunks draw a bar with the same tally', () => {
  tree([fileState({ path: 'big.ts', hunks: 12, verdicts: { pending: 9, accepted: 2, rejected: 1 } })]);
  expect(screen.getByRole('img', { name: '2 accepted, 1 rejected, 9 undecided' })).toBeTruthy();
});

// Invariant: the legend's accepted and rejected glyphs carry the pips' tones (green, red), not the muted text colour.
test('the legend glyphs for accepted and rejected are toned like the pips', () => {
  tree([fileState({ path: 'a.ts' })]);
  const glyphs = screen.getAllByText('■');
  expect(glyphs.map((g) => /\btext-success\b/.test(g.className))).toEqual([true, false]);
  expect(/\btext-destructive\b/.test(glyphs[1].className)).toBe(true);
});
