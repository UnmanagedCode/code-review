import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import type { Row } from '@/lib/diffRows';
import { GapRow } from './GapRow';

const gap = (remaining: number): Extract<Row, { kind: 'gap' }> => ({ kind: 'gap', key: 'g', gapKey: 'after:h1', remaining, from: 5, to: 4 + remaining, side: 'new' });

test('a large gap can grow from either edge or open fully; each button reports its direction', async () => {
  const onExpand = vi.fn();
  render(<GapRow row={gap(100)} first={false} last={false} readOnly={false} onExpand={onExpand} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /below/ }));
  await user.click(screen.getByRole('button', { name: /above/ }));
  await user.click(screen.getByRole('button', { name: 'Show all' }));
  expect(onExpand.mock.calls.map((c) => c[0])).toEqual(['top', 'bottom', 'all']);
});

test('the leading gap only grows upward from its hunk and the trailing one only downward', () => {
  const { unmount } = render(<GapRow row={gap(100)} first last={false} readOnly={false} onExpand={() => {}} />);
  expect(screen.queryByRole('button', { name: /below/ })).toBeNull();
  expect(screen.getByRole('button', { name: /above/ })).toBeTruthy();
  unmount();
  render(<GapRow row={gap(100)} first={false} last readOnly={false} onExpand={() => {}} />);
  expect(screen.queryByRole('button', { name: /above/ })).toBeNull();
});

test('a small gap only offers Show all, and a read-only view offers nothing', () => {
  const { unmount } = render(<GapRow row={gap(4)} first={false} last={false} readOnly={false} onExpand={() => {}} />);
  expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Show all']);
  unmount();
  render(<GapRow row={gap(4)} first={false} last={false} readOnly onExpand={() => {}} />);
  expect(screen.queryByRole('button')).toBeNull();
});
