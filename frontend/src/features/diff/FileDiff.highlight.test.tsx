import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test } from 'vitest';
import type { DiffFile, DiffLine } from '@/lib/types';
import { WIDE_QUERY } from '@/lib/useMediaQuery';
import { installMedia } from '@/test/fakeMedia';
import { installResizeObserver } from '@/test/fakeResizeObserver';
import { diffFile, hunk, thread } from '@/test/fixtures';
import { renderDiff } from '@/test/renderCtx';
import { stubFetch } from '@/test/stubFetch';
import { FileDiff } from './FileDiff';

let ro: ReturnType<typeof installResizeObserver>;
beforeEach(() => {
  installMedia({ [WIDE_QUERY]: true });
  ro = installResizeObserver();
});

const L = (t: DiffLine['t'], old: number | null, nu: number | null, text: string): DiffLine => ({ t, old, new: nu, text });
// old 1–4, new 1–4: a keyword line, a changed call, two context lines.
const code = (over: Partial<DiffFile> = {}) => diffFile({
  hunks: [hunk({ lines: [L('ctx', 1, 1, 'const a = 1;'), L('ctx', 2, 2, 'let b = a;'), L('del', 3, null, 'foo(1);'), L('add', null, 3, 'foo(2);'), L('ctx', 4, 4, 'return b;')] })],
  ...over,
});
const show = (file: DiffFile, view: 'inline' | 'split' = 'inline') => {
  history.replaceState(null, '', `?file=${encodeURIComponent(file.path)}`);
  localStorage.setItem('code-review:diffView', view);
  const r = renderDiff(<FileDiff />, file);
  ro.resize('all', 1000);
  return r;
};
const grid = () => screen.getByRole('grid');
const highlighted = () => waitFor(() => expect(grid().querySelector('[data-token]')).not.toBeNull());
/** The text cells of the grid's line rows (inline: the last cell; split: the 3rd and 6th). */
const textCells = (split: boolean) => [...grid().querySelectorAll('[role="row"]')].flatMap((row) => {
  const cells = [...row.querySelectorAll<HTMLElement>(':scope > [role="gridcell"]')];
  return split ? [cells[2], cells[5]] : [cells[3]];
});

// Invariant: once the lazy tokenizer loads, code cells carry syntax tokens and paired changed lines carry word emphasis.
test('code cells get syntax token spans and paired lines get word emphasis', async () => {
  show(code());
  await highlighted();
  expect(within(grid()).getByText('const').hasAttribute('data-token')).toBe(true);
  const em = [...grid().querySelectorAll('[data-emphasis]')].map((e) => e.textContent);
  expect(em).toEqual(['1', '2']);
});

describe.each(['inline', 'split'] as const)('%s', (view) => {
  // Invariant: file content reaches the DOM only as text: markup in a line never becomes an element, and each cell's text is the line.
  test('an HTML file holding markup renders no element from it and each cell\'s text equals its line', async () => {
    const evil = ['<img src=x onerror=alert(1)>', '<script>alert(1)</script>', '<a href="javascript:alert(1)">x</a>'];
    const file = diffFile({
      path: 'page.html',
      hunks: [hunk({ lines: [L('ctx', 1, 1, evil[0]), L('del', 2, null, evil[1]), L('add', null, 2, evil[2]), L('ctx', 3, 3, '<b>ok</b>')] })],
    });
    show(file, view);
    await highlighted();
    expect(grid().querySelector('img, script, a, b')).toBeNull();
    const texts = textCells(view === 'split').map((c) => c?.textContent ?? '');
    for (const line of [evil[0], evil[1], evil[2], '<b>ok</b>']) expect(texts).toContain(line);
  });

  // Invariant: highlighting changes only the text cell: range rails, thread placement and the composer anchor are as on a plain row.
  test('on highlighted rows the rail, the thread card under its end line and the composer anchor are unchanged', async () => {
    const net = stubFetch({ 'POST api/reviews/r-1/threads': { thread: thread() } });
    const t = thread({ anchor: { ...thread().anchor, side: 'new', startLine: 2, endLine: 3 } });
    show(code({ threads: [t] }), view);
    await highlighted();
    for (const n of [2, 3]) expect(document.querySelector(`[data-cell="new:${n}"] [data-rails]`)).not.toBeNull();
    expect(document.querySelector('[data-cell="new:1"] [data-rails]')).toBeNull();
    const rows = screen.getAllByRole('row');
    const end = document.querySelector('[data-cell="new:3"]')!.closest('[role="row"]')!;
    const next = rows[rows.indexOf(end as HTMLElement) + 1];
    const card = screen.getByRole('article', { name: 'comment thread' });
    expect(end.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(next.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    const cell = document.querySelector<HTMLElement>('[data-cell="new:1"]')!;
    fireEvent.keyDown(cell, { key: 'Enter' });
    fireEvent.keyDown(cell, { key: 'ArrowDown', shiftKey: true });
    fireEvent.keyDown(document.querySelector<HTMLElement>('[data-cell="new:2"]')!, { key: 'c' });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Message'), 'note');
    await user.click(screen.getByRole('button', { name: 'Post' }));
    await waitFor(() => expect(net.calls[0].body).toMatchObject({ anchor: { file: 'src/a.ts', side: 'new', startLine: 1, endLine: 2 } }));
  });
});
