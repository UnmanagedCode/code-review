import { act, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import { parseRoute } from '@/lib/route';
import { WIDE_QUERY } from '@/lib/useMediaQuery';
import { dispatchShortcut } from '@/state/shortcutRegistry';
import { installMedia } from '@/test/fakeMedia';
import { diffFile, fileState, review } from '@/test/fixtures';
import { renderDiff, renderInReview } from '@/test/renderCtx';
import { stubFetch } from '@/test/stubFetch';
import { FileDiff } from '@/features/diff/FileDiff';
import { ReviewPane } from '@/features/review/ReviewPane';
import type { ShortcutId } from '@/lib/shortcuts';

beforeEach(() => { installMedia({ [WIDE_QUERY]: true }); history.replaceState(null, '', '?file=a.ts'); });

/** What the global key listener does for a matched key: the handler runs, and `preventDefault` only when it acted. */
const press = (id: ShortcutId, key: string) => {
  const e = new KeyboardEvent('keydown', { key, cancelable: true });
  const acted = dispatchShortcut(id, e);
  return { acted, prevented: e.defaultPrevented };
};
const VIEWED = { file: 'a.ts', viewed: true, review: review({ rev: 2 }), fileSig: { path: 'a.ts', sig: 's-2' } };

// Invariant: with a file open, `v` toggles that file's viewed mark through the same write as the button: it marks with the file's shown hunk ids, and clears with null once marked.
test('v marks the open file viewed with its shown hunk ids, then clears it', async () => {
  const net = stubFetch({ 'PUT api/reviews/r-1/files/viewed': VIEWED });
  const file = fileState({ path: 'a.ts', hunkIds: ['h1', 'h2'] });
  const first = renderDiff(<FileDiff />, diffFile({ path: 'a.ts' }), { files: [file] });
  expect(press('toggle-viewed', 'v')).toEqual({ acted: true, prevented: true });
  await waitFor(() => expect(net.calls[0].body).toEqual({ file: 'a.ts', hunkIds: ['h1', 'h2'] }));
  first.unmount();
  renderDiff(<FileDiff />, diffFile({ path: 'a.ts' }), { files: [{ ...file, viewed: true }] });
  press('toggle-viewed', 'v');
  await waitFor(() => expect(net.calls[1].body).toEqual({ file: 'a.ts', hunkIds: null }));
});

// Invariant: with no file open (no header mounted) or in a read-only view, nothing is registered: the key is a no-op and keeps its browser default.
test('v registers nothing without an open file or when read-only', () => {
  stubFetch({});
  expect(press('toggle-viewed', 'v')).toEqual({ acted: false, prevented: false });
  renderDiff(<FileDiff />, diffFile({ path: 'a.ts' }), { readOnly: true });
  expect(press('toggle-viewed', 'v')).toEqual({ acted: false, prevented: false });
});

// Invariant: `/` from another pane tab brings the Files tab forward and focuses the filter; with the Files tab already showing it just focuses.
test('/ switches the pane from Threads to Files and focuses the filter', async () => {
  stubFetch({ 'GET api/reviews/r-1/commits': { commits: [] } });
  history.replaceState(null, '', '?view=threads');
  renderInReview(<ReviewPane />, { files: [fileState({ path: 'a.ts' })] });
  expect(screen.getByRole('tab', { name: /^Threads/ }).getAttribute('aria-selected')).toBe('true');
  let result!: ReturnType<typeof press>;
  await act(async () => { result = press('focus-file-filter', '/'); });
  expect(result).toEqual({ acted: true, prevented: true });
  expect(parseRoute(location.search).view).toBeUndefined();
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: 'Filter files' })));
  await act(async () => { (document.activeElement as HTMLElement).blur(); press('focus-file-filter', '/'); });
  expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: 'Filter files' }));
});

// Invariant: without the tree mounted (a narrow layout with a file open) `/` has no handler and falls through to the browser.
test('/ has no handler when no file tree is mounted', () => {
  stubFetch({});
  renderDiff(<FileDiff />, diffFile({ path: 'a.ts' }));
  expect(press('focus-file-filter', '/')).toEqual({ acted: false, prevented: false });
});
