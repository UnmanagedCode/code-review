import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test } from 'vitest';
import { clampPane, DIFF_MIN_PX, KEY_BIG_STEP_PX, KEY_STEP_PX, PANE_DEFAULT_PX, PANE_MIN_PX } from '@/lib/paneWidth';
import { installResizeObserver } from '@/test/fakeResizeObserver';
import { DesktopLayout } from './layouts';

const ROOM = 1600; // the layout's width, shared by the pane and the diff
let ro: ReturnType<typeof installResizeObserver>;
beforeEach(() => { ro = installResizeObserver(); });

const show = (room = ROOM) => {
  const r = render(<DesktopLayout left={<p>pane</p>} center={<p>centre</p>} />);
  ro.resize('all', room);
  return r;
};
const handle = () => screen.getByRole('separator', { name: 'Resize side pane' });
const now = () => Number(handle().getAttribute('aria-valuenow'));
const stored = () => localStorage.getItem('code-review:sidePaneWidth');

// Invariant: every DesktopLayout (the review's pane and App's checkout column) has the handle, and it controls the pane.
test('the side pane has a resize handle that controls it', () => {
  show();
  const pane = screen.getByText('pane').parentElement as HTMLElement;
  expect(handle().getAttribute('aria-controls')).toBe(pane.id);
  expect(pane.tagName).toBe('ASIDE');
});

// Invariant: with nothing stored the pane has the default width.
test('with nothing stored the pane has the default width', () => {
  show();
  expect(now()).toBe(PANE_DEFAULT_PX);
  expect((screen.getByText('pane').parentElement!.parentElement as HTMLElement).style.width).toBe(`${PANE_DEFAULT_PX}px`);
});

// Invariant: the keyboard path resizes (→ widens, since the handle is on the right edge), clamps and persists.
test('arrow keys, Shift and Home/End resize the pane and store each step', async () => {
  show();
  await userEvent.tab();
  expect(document.activeElement).toBe(handle());
  const steps: [string, () => number][] = [
    ['{ArrowRight}', () => PANE_DEFAULT_PX + KEY_STEP_PX],
    ['{ArrowLeft}', () => PANE_DEFAULT_PX],
    ['{Shift>}{ArrowRight}{/Shift}', () => PANE_DEFAULT_PX + KEY_BIG_STEP_PX],
    ['{Home}', () => PANE_MIN_PX],
    ['{End}', () => clampPane(Infinity, ROOM)],
  ];
  for (const [keys, want] of steps) {
    await userEvent.keyboard(keys);
    expect(now()).toBe(want());
    expect(stored()).toBe(String(want()));
  }
});

// Invariant: the keyboard can't exceed the clamp.
test('repeated ArrowRight stops at the maximum', () => {
  show();
  for (let i = 0; i < 40; i++) fireEvent.keyDown(handle(), { key: 'ArrowRight' });
  expect(now()).toBe(clampPane(Infinity, ROOM));
});

// Invariant: dragging right widens, and the release commits.
test('dragging the handle right widens the pane and stores it on release', () => {
  show();
  fireEvent.pointerDown(handle(), { button: 0, clientX: 400, pointerId: 1 });
  fireEvent.pointerMove(handle(), { clientX: 500, pointerId: 1 });
  expect(now()).toBe(PANE_DEFAULT_PX + 100);
  expect(stored()).toBeNull();
  fireEvent.pointerUp(handle(), { clientX: 500, pointerId: 1 });
  expect(stored()).toBe(String(PANE_DEFAULT_PX + 100));
});

// Invariant: a cancelled drag changes nothing.
test('a cancelled drag reverts and stores nothing', () => {
  show();
  fireEvent.pointerDown(handle(), { button: 0, clientX: 400, pointerId: 1 });
  fireEvent.pointerMove(handle(), { clientX: 500, pointerId: 1 });
  fireEvent.pointerCancel(handle(), { pointerId: 1 });
  expect(now()).toBe(PANE_DEFAULT_PX);
  expect(stored()).toBeNull();
});

// Invariant: a click on the handle (no movement) never overwrites the remembered width with a clamped one.
test('a press and release without moving stores nothing', () => {
  localStorage.setItem('code-review:sidePaneWidth', '600');
  show(900);
  fireEvent.pointerDown(handle(), { button: 0, clientX: 500, pointerId: 1 });
  fireEvent.pointerUp(handle(), { clientX: 500, pointerId: 1 });
  expect(stored()).toBe('600');
  ro.resize('all', ROOM);
  expect(now()).toBe(600);
});

// Invariant: the width persists across reloads.
test('a chosen width survives a remount', () => {
  const { unmount } = show();
  fireEvent.keyDown(handle(), { key: 'ArrowRight' });
  const w = now();
  unmount();
  show();
  expect(now()).toBe(w);
});

// Invariant: a narrower window narrows the pane live without forgetting the user's width.
test('a smaller room narrows the pane without changing the stored width', () => {
  localStorage.setItem('code-review:sidePaneWidth', '600');
  show(900);
  expect(now()).toBe(900 - DIFF_MIN_PX);
  expect(stored()).toBe('600');
  ro.resize('all', ROOM);
  expect(now()).toBe(600);
});
