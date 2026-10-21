import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test } from 'vitest';
import { clampPanel, DIFF_MIN_PX, KEY_BIG_STEP_PX, KEY_STEP_PX, PANEL_DEFAULT_PX, PANEL_MIN_PX } from '@/lib/panelWidth';
import { installResizeObserver } from '@/test/fakeResizeObserver';
import { DesktopLayout } from './layouts';

const ROOM = 1600; // happy-dom measures the left column as 0 wide, so the room is the layout's width.
let ro: ReturnType<typeof installResizeObserver>;
beforeEach(() => { ro = installResizeObserver(); });

const show = (right = true, room = ROOM) => {
  const r = render(<DesktopLayout left={<p>left</p>} center={<p>centre</p>} right={right ? <p>panel</p> : undefined} />);
  ro.resize('all', room);
  return r;
};
const handle = () => screen.getByRole('separator', { name: 'Resize threads panel' });
const now = () => Number(handle().getAttribute('aria-valuenow'));
const stored = () => localStorage.getItem('code-review:threadPanelWidth');

// Invariant: only the side column is resizable (App's and other DesktopLayout uses are unchanged).
test('without a right column there is no resize handle', () => {
  show(false);
  expect(screen.queryByRole('separator')).toBeNull();
});

// Invariant: today's width is the default.
test('with nothing stored the panel has the default width', () => {
  show();
  expect(now()).toBe(PANEL_DEFAULT_PX);
  expect((screen.getByText('panel').parentElement as HTMLElement).style.width).toBe(`${PANEL_DEFAULT_PX}px`);
});

// Invariant: the keyboard path resizes, clamps and persists.
test('arrow keys, Shift and Home/End resize the panel and store each step', async () => {
  show();
  await userEvent.tab();
  expect(document.activeElement).toBe(handle());
  const steps: [string, () => number][] = [
    ['{ArrowLeft}', () => PANEL_DEFAULT_PX + KEY_STEP_PX],
    ['{ArrowRight}', () => PANEL_DEFAULT_PX],
    ['{Shift>}{ArrowLeft}{/Shift}', () => PANEL_DEFAULT_PX + KEY_BIG_STEP_PX],
    ['{Home}', () => PANEL_MIN_PX],
    ['{End}', () => clampPanel(Infinity, ROOM)],
  ];
  for (const [keys, want] of steps) {
    await userEvent.keyboard(keys);
    expect(now()).toBe(want());
    expect(stored()).toBe(String(want()));
  }
});

// Invariant: the keyboard can't exceed the clamp.
test('repeated ArrowLeft stops at the maximum', () => {
  show();
  for (let i = 0; i < 40; i++) fireEvent.keyDown(handle(), { key: 'ArrowLeft' });
  expect(now()).toBe(clampPanel(Infinity, ROOM));
});

// Invariant: dragging left widens, and the release commits.
test('dragging the handle left widens the panel and stores it on release', () => {
  show();
  fireEvent.pointerDown(handle(), { button: 0, clientX: 1000, pointerId: 1 });
  fireEvent.pointerMove(handle(), { clientX: 900, pointerId: 1 });
  expect(now()).toBe(PANEL_DEFAULT_PX + 100);
  expect(stored()).toBeNull();
  fireEvent.pointerUp(handle(), { clientX: 900, pointerId: 1 });
  expect(stored()).toBe(String(PANEL_DEFAULT_PX + 100));
});

// Invariant: a cancelled drag changes nothing.
test('a cancelled drag reverts and stores nothing', () => {
  show();
  fireEvent.pointerDown(handle(), { button: 0, clientX: 1000, pointerId: 1 });
  fireEvent.pointerMove(handle(), { clientX: 900, pointerId: 1 });
  fireEvent.pointerCancel(handle(), { pointerId: 1 });
  expect(now()).toBe(PANEL_DEFAULT_PX);
  expect(stored()).toBeNull();
});

// Invariant: a click on the handle (no movement) never overwrites the remembered width with a clamped one.
test('a press and release without moving stores nothing', () => {
  localStorage.setItem('code-review:threadPanelWidth', '600');
  show(true, 900);
  fireEvent.pointerDown(handle(), { button: 0, clientX: 500, pointerId: 1 });
  fireEvent.pointerUp(handle(), { clientX: 500, pointerId: 1 });
  expect(stored()).toBe('600');
  ro.resize('all', ROOM);
  expect(now()).toBe(600);
});

// Invariant: the width persists across reloads.
test('a chosen width survives a remount', () => {
  const { unmount } = show();
  fireEvent.keyDown(handle(), { key: 'ArrowLeft' });
  const w = now();
  unmount();
  show();
  expect(now()).toBe(w);
});

// Invariant: a narrower window narrows the panel live without forgetting the user's width.
test('a smaller room narrows the panel without changing the stored width', () => {
  localStorage.setItem('code-review:threadPanelWidth', '600');
  show(true, 900);
  expect(now()).toBe(900 - DIFF_MIN_PX);
  expect(stored()).toBe('600');
  ro.resize('all', ROOM);
  expect(now()).toBe(600);
});
