import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { parseRoute } from '@/lib/route';
import { groupAnchor, linesAnchor, message, thread, threadDigest } from '@/test/fixtures';
import { renderInReview } from '@/test/renderCtx';
import { ThreadRow, rowOf } from './ThreadRow';

const NOW = Date.parse('2026-01-01T03:00:00Z');

// Invariant: a row is one button named "<state>: <place> — <preview>" that opens the thread in place, showing the state chip, kind and age.
test('a digest row names its state, place and preview and opens the thread', async () => {
  history.replaceState(null, '', '?review=r-1');
  const d = threadDigest({ id: 't-5', state: 'verify-resolution', kind: 'question', anchor: linesAnchor({ file: 'src/deep/a.ts', startLine: 3, endLine: 5 }), last: { author: { kind: 'human' }, at: '2026-01-01T00:00:00Z', preview: 'is this right?', proposeResolve: false } });
  renderInReview(<ThreadRow row={d} guide={null} now={NOW} />);
  const row = screen.getByRole('button', { name: 'Agent says fixed — verify: a.ts#L3–L5 — is this right?' });
  expect(within(row).getByText('Agent says fixed — verify')).toBeTruthy();
  expect(within(row).getByText('question')).toBeTruthy();
  expect(within(row).getByText('3 h')).toBeTruthy();
  expect(row.getAttribute('title')).toBe('src/deep/a.ts#L3–L5');
  await userEvent.setup().click(row);
  expect(parseRoute(location.search)).toMatchObject({ review: 'r-1', file: 'src/deep/a.ts', thread: 't-5' });
});

// Invariant: a full thread becomes a row through rowOf: its last message's body is the preview, a stateless thread shows its status, and unread shows as a dot.
test('rowOf maps a resolved thread: status instead of state, the last body as preview, an unread dot', () => {
  const t = thread({ id: 't-2', status: 'resolved', state: null, unread: 2, messages: [message({ body: 'first' }), message({ id: 2, body: 'the last word', at: '2026-01-01T02:00:00Z' })] });
  renderInReview(<ThreadRow row={rowOf(t)} guide={null} now={NOW} />);
  const row = screen.getByRole('button', { name: 'resolved: a.ts#L3 — the last word' });
  expect(within(row).getByText('resolved')).toBeTruthy();
  expect(within(row).getByRole('img', { name: '2 unread' })).toBeTruthy();
});

// Invariant: a row's place for a group thread is the group's title, for a review thread "review".
test('group and review places', () => {
  const guide = { round: 1, groups: [{ id: 'g1', title: 'Wire it up' }], retired: [] } as never;
  renderInReview(<>
    <ThreadRow row={threadDigest({ id: 't-1', anchor: groupAnchor() })} guide={guide} now={NOW} />
    <ThreadRow row={threadDigest({ id: 't-2', anchor: { kind: 'review', round: 1 } })} guide={null} now={NOW} />
  </>);
  expect(screen.getByRole('button', { name: /: Wire it up — / })).toBeTruthy();
  expect(screen.getByRole('button', { name: /: review — / })).toBeTruthy();
});
