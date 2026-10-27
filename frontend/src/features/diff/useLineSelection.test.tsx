import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { buildRows } from '@/lib/diffRows';
import { diffFile, hunk, thread } from '@/test/fixtures';
import { renderDiff } from '@/test/renderCtx';
import { stubFetch } from '@/test/stubFetch';
import { FileDiff } from './FileDiff';
import { useLineSelection } from './useLineSelection';

// Rows: c1 c2 (del 3) add3 c4 → new lines 1,2,3,4; old lines 1,2,3,4.
const show = (over = {}) => { history.replaceState(null, '', '?file=src%2Fa.ts'); return renderDiff(<FileDiff />, diffFile(), over); };
const cell = (side: string, n: number) => document.querySelector<HTMLElement>(`[data-cell="${side}:${n}"]`)!;
const label = () => screen.queryByRole('toolbar', { name: 'Selection' })?.textContent ?? null;

const composer = () => screen.queryByRole('form', { name: /^Comment on / });
const composerName = () => composer()?.getAttribute('aria-label') ?? null;
const down = (side: string, n: number, over = {}) => fireEvent.pointerDown(cell(side, n), { button: 0, buttons: 1, pointerType: 'mouse', ...over });

// Invariant: a mouse gutter drag opens the composer for the dragged range on release, with no toolbar step and the message focused.
test('mouse: releasing a gutter drag opens the composer for that range with no intermediate menu', async () => {
  const net = stubFetch({ 'POST api/reviews/r-1/threads': { thread: thread(), fileSig: { path: 'src/a.ts', sig: 's-2' } } });
  const user = userEvent.setup();
  show();
  down('new', 2);
  fireEvent.pointerEnter(cell('new', 4), { buttons: 1, pointerType: 'mouse' });
  expect(label()).toBeNull(); // nothing renders under the selection mid-drag, so the rows under the pointer do not move
  expect(composer()).toBeNull();
  fireEvent.pointerUp(window);
  expect(composerName()).toBe('Comment on L2–L4 (new)');
  expect(label()).toBeNull();
  expect(document.activeElement).toBe(screen.getByLabelText('Message'));
  fireEvent.pointerEnter(cell('new', 1), { buttons: 1 });
  expect(composerName()).toBe('Comment on L2–L4 (new)');
  await user.type(screen.getByLabelText('Message'), 'note');
  await user.click(screen.getByRole('button', { name: 'Post' }));
  await waitFor(() => expect(net.calls[0].body).toMatchObject({ anchor: { file: 'src/a.ts', side: 'new', startLine: 2, endLine: 4 } }));
});

// Invariant: only a released primary press on a line number opens the composer; code text, stray releases, other buttons and cancelled presses never do.
test('mouse: only a released press on a line number opens the composer', () => {
  show();
  const code = screen.getByText('c2');
  fireEvent.pointerDown(code, { button: 0, buttons: 1, pointerType: 'mouse' });
  fireEvent.pointerUp(code);
  expect(composer()).toBeNull();
  fireEvent.pointerUp(window);
  expect(composer()).toBeNull();
  down('new', 2, { button: 2, buttons: 2 });
  fireEvent.pointerUp(window);
  expect(composer()).toBeNull();
  down('new', 3);
  fireEvent.pointerCancel(window);
  expect(label()).toContain('L3 (new)');
  fireEvent.pointerUp(window);
  expect(composer()).toBeNull();
  expect(label()).toContain('L3 (new)');
});

test('mouse: a drag onto the other side’s gutter does not extend; a plain click elsewhere restarts', () => {
  show();
  down('new', 2);
  fireEvent.pointerEnter(cell('old', 3), { buttons: 1 });
  fireEvent.pointerUp(window);
  expect(composerName()).toBe('Comment on L2 (new)');
  down('old', 4);
  fireEvent.pointerUp(window);
  expect(composerName()).toBe('Comment on L4 (old)');
});

test('mouse: shift+click extends from the anchor', () => {
  show();
  down('new', 1);
  fireEvent.pointerUp(window);
  down('new', 3, { shiftKey: true });
  fireEvent.pointerUp(window);
  expect(composerName()).toBe('Comment on L1–L3 (new)');
});

test('touch: tap selects one line, a second tap extends, tapping an endpoint clears', () => {
  show();
  fireEvent.pointerDown(cell('new', 1), { button: 0, pointerType: 'touch' });
  expect(label()).toContain('L1 (new)');
  fireEvent.pointerDown(cell('new', 4), { button: 0, pointerType: 'touch' });
  expect(label()).toContain('L1–L4 (new)');
  fireEvent.pointerUp(window);
  expect(composer()).toBeNull(); // touch keeps the toolbar: a composer would pop the soft keyboard mid-extension
  fireEvent.pointerDown(cell('new', 4), { button: 0, pointerType: 'touch' });
  expect(label()).toBeNull();
});

test('keyboard: arrows move, Shift+Arrow extends, c opens the composer with the exact anchor, Esc clears', async () => {
  const net = stubFetch({ 'POST api/reviews/r-1/threads': { thread: thread(), fileSig: { path: 'src/a.ts', sig: 's-2' } } });
  const user = userEvent.setup();
  show();
  cell('new', 1).focus();
  await user.keyboard('{ArrowDown}');
  expect(document.activeElement).toBe(cell('new', 2));
  await user.keyboard('{Shift>}{ArrowDown}{/Shift}');
  expect(label()).toContain('L2–L3 (new)');
  await user.keyboard('c');
  await user.type(screen.getByLabelText('Message'), 'note');
  await user.click(screen.getByRole('button', { name: 'Post' }));
  await waitFor(() => expect(net.calls[0].body).toEqual({ anchor: { file: 'src/a.ts', side: 'new', startLine: 2, endLine: 3 }, kind: 'comment', body: 'note' }));
});

test('keyboard: Space selects the focused line, ArrowLeft switches side, Esc clears', async () => {
  const user = userEvent.setup();
  show();
  cell('new', 2).focus();
  await user.keyboard('{ArrowLeft}');
  expect(document.activeElement).toBe(cell('old', 2));
  await user.keyboard(' ');
  expect(label()).toContain('L2 (old)');
  expect(composer()).toBeNull();
  await user.keyboard('{Escape}');
  expect(label()).toBeNull();
});

test('the diff is one tab stop', () => {
  show();
  expect(document.querySelectorAll('[data-cell][tabindex="0"]')).toHaveLength(1);
});

test('read-only views (closed review or commit filter) offer no selection', () => {
  show({ readOnly: true });
  expect(document.querySelector('[data-cell]')).toBeNull();
});

test('expanding the leading gap (rows[0] changes) keeps the selection; another file clears it', () => {
  const h = hunk();
  const collapsed = buildRows({ hunks: [h], expansions: {}, texts: { 1: 'x' }, total: null });
  const expanded = buildRows({ hunks: [{ ...h, oldStart: 3, newStart: 3 }], expansions: { pre: { top: 0, bottom: 2 } }, texts: { 1: 'x', 2: 'y' }, total: null });
  expect(collapsed[0].key).not.toBe(expanded[0].key);
  const { result, rerender } = renderHook(({ rows, key }) => useLineSelection(rows, true, key), { initialProps: { rows: collapsed, key: 'r-1:a.ts' } });
  act(() => result.current.onPointerDown('new', 2)({ button: 0, pointerType: 'touch' } as never));
  expect(result.current.selection).toMatchObject({ start: 2, end: 2 });
  rerender({ rows: expanded, key: 'r-1:a.ts' });
  expect(result.current.selection).toMatchObject({ start: 2, end: 2 });
  rerender({ rows: expanded, key: 'r-1:b.ts' });
  expect(result.current.selection).toBeNull();
});

test('the grid keeps exactly one tab stop after the focused line disappears from the rows', () => {
  const full = buildRows({ hunks: [hunk()], expansions: {}, texts: {}, total: null });
  const without = buildRows({ hunks: [hunk({ lines: [{ t: 'ctx', old: 1, new: 1, text: 'c1' }, { t: 'ctx', old: 2, new: 2, text: 'c2' }] })], expansions: {}, texts: {}, total: null });
  const stops = (rows: typeof full, tab: (s: 'old' | 'new', n: number) => boolean) =>
    rows.flatMap((r) => (r.kind === 'line' ? (['old', 'new'] as const).flatMap((s) => (r.line[s] != null && tab(s, r.line[s]!) ? [`${s}:${r.line[s]}`] : [])) : []));
  const { result, rerender } = renderHook(({ rows }) => useLineSelection(rows, true, 'r-1:a.ts'), { initialProps: { rows: full } });
  act(() => result.current.onPointerDown('new', 4)({ button: 0, pointerType: 'touch' } as never));
  expect(stops(full, result.current.tabStop)).toEqual(['new:4']);
  rerender({ rows: without }); // an uncommitted poll removed that line
  expect(stops(without, result.current.tabStop)).toHaveLength(1);
});
