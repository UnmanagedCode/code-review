import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { diffFile, hunk, message, review, thread, linesAnchor } from '@/test/fixtures';
import type { Thread } from '@/lib/types';
import { stubFetch } from '@/test/stubFetch';
import type { FileDiffState } from '@/state/fileDiff';
import { renderDiff, renderInReview } from '@/test/renderCtx';
import { FileDiff } from './FileDiff';

const withRoute = (file: string) => history.replaceState(null, '', `?file=${encodeURIComponent(file)}`);

test('code text and a path containing markup render as text nodes, not elements', () => {
  const path = 'src/<b>x</b>.ts';
  withRoute(path);
  const h = hunk({ lines: [{ t: 'add', old: null, new: 1, text: '<script>alert(1)</script>' }], oldStart: 1, oldLines: 0, newStart: 1, newLines: 1 });
  const { container } = renderDiff(<FileDiff />, diffFile({ path, hunks: [h] }));
  expect(container.querySelector('script, b')).toBeNull();
  expect(screen.getByText('<script>alert(1)</script>')).toBeTruthy();
  expect(screen.getByText(path)).toBeTruthy();
});

test.each([[{ binary: true }, 'Binary file changed'], [{ tooLarge: true }, 'Too large to diff']])('%o shows a placeholder with only the verdict bar', (flags, text) => {
  withRoute('img.png');
  renderDiff(<FileDiff />, diffFile({ path: 'img.png', ...flags, hunks: [{ id: 'f1', kind: 'file', lines: [], verdict: 'pending' }] }));
  expect(screen.getByText(text)).toBeTruthy();
  expect(screen.getByRole('group', { name: 'Hunk verdict' })).toBeTruthy();
  expect(screen.queryByRole('grid')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Comment on hunk' })).toBeNull();
});

test('threads render under the row of their end line', () => {
  withRoute('src/a.ts');
  const t = thread({ anchor: linesAnchor({ side: 'new', startLine: 3, endLine: 3 }) });
  renderDiff(<FileDiff />, diffFile({ threads: [t] }));
  const rows = screen.getAllByRole('row');
  const idx = rows.findIndex((r) => within(r).queryByText('a3'));
  expect(idx).toBeGreaterThan(-1);
  const card = screen.getByRole('article', { name: 'comment thread' });
  // The card follows the row holding new line 3 in document order.
  expect(rows[idx].compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(rows[idx + 1]?.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
});

test('a past round\'s file says which round it shows, so a phone without the sidebar banner still knows', () => {
  withRoute('src/a.ts');
  renderDiff(<FileDiff />, diffFile(), { round: 1, readOnly: true });
  expect(screen.getByText(/round 1/)).toBeTruthy();
});

// Invariant: inline-in-diff annotations go through the same markdown renderer, raw HTML included as text.
test('inline thread bodies in the diff render as markdown', () => {
  withRoute('src/a.ts');
  const body = '# Title\n\n- item\n\n```\ncode\n```\n\n<script>alert(1)</script>';
  const { container } = renderDiff(<FileDiff />, diffFile({ threads: [thread({ messages: [message({ body })] })] }));
  const card = screen.getByRole('article', { name: 'comment thread' });
  expect(within(card).getByRole('heading', { level: 1, name: 'Title' })).toBeTruthy();
  expect(within(card).getByText('item').tagName).toBe('LI');
  expect(card.querySelector('pre')?.textContent).toBe('code');
  expect(container.querySelector('script')).toBeNull();
  expect(within(card).getByText('<script>alert(1)</script>')).toBeTruthy();
});

// Invariant: while the next file loads, the previous file stays on screen (not the Loading skeleton), marked busy and inert.
test('a file switch keeps the previous file visible, busy and inert; a cold load shows Loading', () => {
  withRoute('src/b.ts');
  const file = diffFile({ path: 'src/a.ts' });
  const { container, unmount } = renderInReview(<FileDiff />, { fileDiff: { file, rows: [], total: null, loading: true, switching: true } as unknown as FileDiffState });
  expect(screen.getByText('src/a.ts')).toBeTruthy();
  const busy = container.querySelector('[aria-busy="true"]');
  expect(busy?.hasAttribute('inert')).toBe(true);
  unmount();
  renderInReview(<FileDiff />, { fileDiff: { file: undefined, rows: [], total: null, loading: true, switching: false } as unknown as FileDiffState });
  expect(screen.getByLabelText('Loading diff')).toBeTruthy();
});

// ---- file threads ----

const onFile = (over: Partial<Thread> = {}) => thread({ id: 't-f', anchor: { kind: 'file', file: 'src/a.ts', round: 1 }, ...over });
const BINARY = { path: 'img.png', binary: true, hunks: [{ id: 'f1', kind: 'file' as const, lines: [] as [], verdict: 'pending' as const }] };

// Invariant: the live, writable view offers Comment on file on every file, a binary one included.
test('Comment on file is offered in the live view, on a text file and on a binary file', () => {
  withRoute('src/a.ts');
  const { unmount } = renderDiff(<FileDiff />, diffFile());
  expect(screen.getByRole('button', { name: 'Comment on file' })).toBeTruthy();
  unmount();
  withRoute('img.png');
  renderDiff(<FileDiff />, diffFile(BINARY));
  expect(screen.getByRole('button', { name: 'Comment on file' })).toBeTruthy();
});

// Invariant: where writes are off (closed review, past round, comparison, commit filter) there is no Comment on file.
test.each([
  ['a closed review', { review: review({ status: 'closed' }), readOnly: true }],
  ['a past round', { round: 1, readOnly: true }],
  ['a comparison', { compare: { from: 1, to: 2 }, readOnly: true }],
  ['the commit filter', { commit: 'abc1234', readOnly: true }],
] as const)('no Comment on file in %s', (_, over) => {
  withRoute('src/a.ts');
  renderDiff(<FileDiff />, diffFile(), over);
  expect(screen.queryByRole('button', { name: 'Comment on file' })).toBeNull();
});

// Invariant: the file composer posts a file anchor naming the open file, with no side or lines.
test('Comment on file opens a composer in the file-threads block that posts {kind: file, file}', async () => {
  withRoute('src/a.ts');
  const net = stubFetch({ 'POST api/reviews/r-1/threads': { thread: onFile(), fileSig: { path: 'src/a.ts', sig: 's-2' } } });
  const user = userEvent.setup();
  renderDiff(<FileDiff />, diffFile());
  await user.click(screen.getByRole('button', { name: 'Comment on file' }));
  const block = screen.getByRole('region', { name: 'File threads' });
  await user.type(within(block).getByLabelText('Message'), 'whole thing');
  await user.click(within(block).getByRole('button', { name: 'Post' }));
  await waitFor(() => expect(net.calls.find((c) => c.method === 'POST')?.body).toEqual({ anchor: { kind: 'file', file: 'src/a.ts' }, kind: 'comment', body: 'whole thing' }));
});

// Invariant: a file thread is shown in the block above the grid, never under a row; a line thread stays under its row.
test('a file thread renders in the file-threads block, not under a row', () => {
  withRoute('src/a.ts');
  renderDiff(<FileDiff />, diffFile({ threads: [onFile(), thread({ id: 't-l' })] }));
  const block = screen.getByRole('region', { name: 'File threads' });
  expect(within(block).getAllByRole('article')).toHaveLength(1);
  expect(within(block).getByText('Whole file')).toBeTruthy();
  expect(within(screen.getByRole('grid')).getAllByRole('article')).toHaveLength(1);
  expect(block.compareDocumentPosition(screen.getByRole('grid')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

// Invariant: a binary file has no rows, but its file threads still show.
test('a binary file shows its file threads', () => {
  withRoute('img.png');
  renderDiff(<FileDiff />, diffFile({ ...BINARY, threads: [onFile({ anchor: { kind: 'file', file: 'img.png', round: 1 } })] }));
  expect(within(screen.getByRole('region', { name: 'File threads' })).getAllByRole('article')).toHaveLength(1);
});
