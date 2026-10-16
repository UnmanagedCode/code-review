import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { parseRoute } from '@/lib/route';
import type { Kind, Round } from '@/lib/types';
import { review } from '@/test/fixtures';
import { renderInReview } from '@/test/renderCtx';
import { RoundPicker } from './RoundPicker';

const rounds = (n: number): Round[] => Array.from({ length: n }, (_, i) => ({ n: i + 1, headSha: `${i + 1}`.repeat(40), baseSha: 'b'.repeat(40), createdAt: '', submittedAt: null }));
const picker = () => screen.queryByRole('combobox', { name: 'Round' }) as HTMLSelectElement | null;
const renderPicker = (kind: Kind, n: number, over = {}) => renderInReview(<RoundPicker />, { review: review({ kind, round: n }), rounds: rounds(n), ...over });

test('absent on commit and uncommitted reviews and on a range review with one round', () => {
  for (const [kind, n] of [['commit', 3], ['uncommitted', 3], ['range', 1]] as const) {
    const { unmount } = renderPicker(kind, n);
    expect(picker(), `${kind} ${n}`).toBeNull();
    unmount();
  }
});

test('lists the current round first, then every past round newest first', () => {
  renderPicker('range', 3);
  expect([...picker()!.options].map((o) => o.value)).toEqual(['', '2', '1']);
  expect(picker()!.value).toBe('');
});

test('shows the viewed past round as selected', () => {
  renderPicker('range', 3, { round: 1, readOnly: true });
  expect(picker()!.value).toBe('1');
});

test('picking a past round navigates to it, clearing the commit filter and the file position', async () => {
  history.replaceState(null, '', '?review=r-1&commit=abc1234&file=a.js&lines=3&side=new&thread=t-1');
  renderPicker('range', 3);
  await userEvent.setup().selectOptions(picker()!, '2');
  expect(parseRoute(location.search)).toEqual({ review: 'r-1', round: '2' });
});

test('picking the current round leaves the round view', async () => {
  history.replaceState(null, '', '?review=r-1&round=1&file=a.js');
  renderPicker('range', 3, { round: 1, readOnly: true });
  await userEvent.setup().selectOptions(picker()!, '');
  expect(parseRoute(location.search)).toEqual({ review: 'r-1' });
});
