import { screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { diffFile, hunk, thread } from '@/test/fixtures';
import { renderDiff } from '@/test/renderCtx';
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
  const t = thread({ anchor: { ...thread().anchor, side: 'new', startLine: 3, endLine: 3 } });
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
