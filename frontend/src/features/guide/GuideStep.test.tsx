import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { expect, test, vi } from 'vitest';
import { parseRoute } from '@/lib/route';
import { forgetCleared } from '@/state/clearedGroups';
import { groupAnchor, linesAnchor, refusal, review, thread } from '@/test/fixtures';
import { expandFile, GuideHarness, guideNet, headerOf, sampleGuide } from '@/test/guideWorld';
import { GuideStepView } from './GuideStepView';

const at = (q: string) => history.replaceState(null, '', `?review=r-1&view=guided${q}`);
const mount = (guide = sampleGuide(), spies = {}) => render(<GuideHarness guide={guide} spies={spies}><GuideStepView /></GuideHarness>);
const groupBar = () => screen.getByRole('group', { name: 'Group verdict' });
const pressed = (bar: HTMLElement) => within(bar).getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent);
const hunkBars = () => screen.getAllByRole('group', { name: 'Hunk verdict' });
const loaded = async (...paths: string[]) => { for (const p of paths) { await screen.findByRole('region', { name: p }); await expandFile(p); } await screen.findAllByRole('group', { name: 'Hunk verdict' }); };

test('shows the step header, its description and its hunks under one section per file', async () => {
  // Invariant: a step reads as "Step i of n", the title, the description, then each file's share of its hunks.
  at('&step=g1');
  guideNet();
  mount();
  expect(screen.getByRole('heading', { name: 'Wire it up' })).toBeTruthy();
  expect(screen.getByText('Step 1 of 3')).toBeTruthy();
  expect(screen.getByText('bold').tagName).toBe('STRONG');
  await loaded('a.ts', 'b.ts');
  expect(within(screen.getByRole('region', { name: 'a.ts' })).getByRole('grid', { name: `Changes in a.ts ${headerOf('h1')}` })).toBeTruthy();
  expect(within(screen.getByRole('region', { name: 'b.ts' })).getByRole('grid', { name: `Changes in b.ts ${headerOf('h3')}` })).toBeTruthy();
  expect(screen.queryByRole('grid', { name: new RegExp(headerOf('h2').replace(/[+]/g, '\\+')) })).toBeNull();
});

test('Next and Previous push history and are disabled at the ends', async () => {
  // Invariant: step moves add history entries; the first step has no Previous, the last none Next.
  at('&step=g1');
  guideNet();
  mount();
  const prev = screen.getByRole('button', { name: 'Previous step' }) as HTMLButtonElement;
  const next = screen.getByRole('button', { name: 'Next step' }) as HTMLButtonElement;
  expect(prev.disabled).toBe(true);
  const before = history.length;
  const user = userEvent.setup();
  await user.click(next);
  expect(parseRoute(location.search)).toMatchObject({ view: 'guided', step: 'g2' });
  await user.click(next);
  expect(parseRoute(location.search).step).toBe('other');
  expect(history.length).toBe(before + 2);
  expect(next.disabled).toBe(true);
  await user.click(prev);
  expect(parseRoute(location.search).step).toBe('g2');
});

test('an unknown step is replaced out of the URL, adding no history entry', async () => {
  at('&step=g9');
  guideNet();
  const before = history.length;
  mount();
  await waitFor(() => expect(parseRoute(location.search).step).toBeUndefined());
  expect(history.length).toBe(before);
});

test('Other changes has no group verdict and no group comment', async () => {
  at('&step=other');
  guideNet();
  mount();
  expect(screen.getByRole('heading', { name: 'Other changes' })).toBeTruthy();
  expect(screen.getByText('Hunks that are in no group.')).toBeTruthy();
  await loaded('b.ts');
  expect(screen.queryByRole('group', { name: 'Group verdict' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Comment on group' })).toBeNull();
});

test('a group verdict is optimistic on the group only: hunks change when the response lists them', async () => {
  // Invariant: the group control flips at once; the hunk bars stay as they were until the response, then show its `hunks`.
  at('&step=g1');
  let answer!: (v: unknown) => void;
  const net = guideNet({}, { 'PUT api/reviews/r-1/groups/g1/verdict': () => new Promise((r) => { answer = r; }) });
  const spies = { reload: vi.fn(), applyReview: vi.fn() };
  mount(sampleGuide(), spies);
  await loaded('a.ts', 'b.ts');
  await userEvent.setup().click(screen.getByRole('button', { name: 'Reject group' }));
  expect(pressed(groupBar())).toEqual(['Reject group']);
  expect(hunkBars().map(pressed)).toEqual([['Pending'], ['Pending']]);
  await waitFor(() => expect(net.calls.at(-1)?.body).toEqual({ verdict: 'rejected' }));
  const guide = sampleGuide({}, { verdict: 'rejected', hunks: [{ id: 'h1', file: 'a.ts', verdict: 'rejected' }, { id: 'h3', file: 'b.ts', verdict: 'rejected' }] });
  answer({ groupId: 'g1', verdict: 'rejected', hunks: [{ id: 'h1', verdict: 'rejected' }, { id: 'h3', verdict: 'rejected' }], fileSigs: [], guide, review: review({ rev: 2 }) });
  await waitFor(() => expect(hunkBars().map(pressed)).toEqual([['Reject'], ['Reject']]));
  expect(pressed(groupBar())).toEqual(['Reject group']);
  expect(spies.applyReview).toHaveBeenCalledWith(review({ rev: 2 }));
  expect(spies.reload).toHaveBeenCalled();
});

test('a refused group verdict reverts the control and toasts the refusal', async () => {
  const error = vi.spyOn(toast, 'error').mockImplementation(() => '');
  at('&step=g1');
  guideNet({}, { 'PUT api/reviews/r-1/groups/g1/verdict': refusal('REVIEW_CLOSED') });
  mount();
  await loaded('a.ts');
  await userEvent.setup().click(screen.getByRole('button', { name: 'Reject group' }));
  await waitFor(() => expect(error).toHaveBeenCalledWith('The review is closed; reopen it to change it'));
  expect(pressed(groupBar())).toEqual(['Pending']);
});

test('a per-hunk verdict that the server says cleared the group flips it to Pending with a note, from the response alone', async () => {
  // Invariant: the group changes only as `clearedGroups` says (no client-side rule), and the step explains it.
  at('&step=g1');
  forgetCleared('r-1', 'g1');
  const rejected = [{ id: 'h1', file: 'a.ts', verdict: 'rejected' as const }, { id: 'h3', file: 'b.ts', verdict: 'rejected' as const }];
  guideNet({ h1: 'rejected', h3: 'rejected' }, {
    'PUT api/reviews/r-1/hunks/h1/verdict': { hunkId: 'h1', verdict: 'accepted', clearedGroups: ['g1'], review: review({ rev: 2 }), fileSig: { path: 'a.ts', sig: 'sa2' } },
  });
  mount(sampleGuide({}, { verdict: 'rejected', hunks: rejected }));
  await loaded('a.ts', 'b.ts');
  expect(pressed(groupBar())).toEqual(['Reject group']);
  expect(screen.queryByText(/Set back to pending/)).toBeNull();
  await userEvent.setup().click(within(hunkBars()[0]).getByRole('button', { name: 'Accept' }));
  await waitFor(() => expect(pressed(groupBar())).toEqual(['Pending']));
  expect(screen.getByText('Set back to pending: you changed the verdict of one of its hunks.')).toBeTruthy();
});

test('an accepted group that still holds a pending hunk says so, and Accept group again re-sends the verdict', async () => {
  at('&step=g1');
  const net = guideNet({ h1: 'accepted' }, { 'PUT api/reviews/r-1/groups/g1/verdict': (): never => { throw new Error('stop'); } });
  mount(sampleGuide({}, { verdict: 'accepted', hunks: [{ id: 'h1', file: 'a.ts', verdict: 'accepted' }, { id: 'h3', file: 'b.ts', verdict: 'pending' }] }));
  expect(screen.getByText('1 hunk still pending — Accept group again to accept them.')).toBeTruthy();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Accept group' }));
  await waitFor(() => expect(net.calls.some((c) => c.method === 'PUT' && c.body && (c.body as { verdict: string }).verdict === 'accepted')).toBe(true));
});

test('Comment on group posts a group anchor', async () => {
  at('&step=g2');
  const net = guideNet({}, { 'POST api/reviews/r-1/threads': { thread: thread({ id: 't-5', anchor: groupAnchor({ groupId: 'g2' }) }), fileSig: null } });
  mount();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Comment on group' }));
  await user.type(screen.getByLabelText('Message'), 'why this?');
  await user.click(screen.getByRole('button', { name: 'Post' }));
  await waitFor(() => expect(net.calls.find((c) => c.method === 'POST')?.body).toEqual({ anchor: { kind: 'group', groupId: 'g2' }, kind: 'comment', body: 'why this?' }));
});

test('group threads are listed in their step, and a routed one is focused and marked read once', async () => {
  at('&step=g1&thread=t-9');
  const t = thread({ id: 't-9', unread: 1, anchor: groupAnchor({ groupId: 'g1' }), messages: [{ id: 1, author: { kind: 'human' }, body: 'about group one', at: '', round: 1, citations: [] }] });
  const other = thread({ id: 't-10', anchor: groupAnchor({ groupId: 'g2' }) });
  const net = guideNet({}, { 'POST api/reviews/r-1/read': { review: review() } });
  mount(sampleGuide({ threads: [t, other] }));
  const card = await screen.findByRole('article', { name: 'comment thread' });
  expect(within(card).getByText('about group one')).toBeTruthy();
  expect(screen.getAllByRole('article')).toHaveLength(1);
  await waitFor(() => expect(net.calls.filter((c) => c.method === 'POST').map((c) => c.body)).toEqual([{ threadId: 't-9' }]));
});

test('a closed review disables the group and hunk bars and offers no comments', async () => {
  at('&step=g1');
  guideNet();
  const guide = sampleGuide({ guideMe: { offered: true, noGroups: false, droppedGroups: 1, newUngrouped: 0 } });
  render(<GuideHarness guide={guide} spies={{ review: review({ status: 'closed' }), readOnly: true }}><GuideStepView /></GuideHarness>);
  await loaded('a.ts');
  for (const b of within(groupBar()).getAllByRole('button')) expect((b as HTMLButtonElement).disabled).toBe(true);
  for (const bar of hunkBars()) for (const b of within(bar).getAllByRole('button')) expect((b as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole('button', { name: 'Comment on group' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Comment on hunk' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Guide me' })).toBeNull();
});

test('Open in file goes to that file at the hunk\'s lines, keeping the Guided tab and step', async () => {
  at('&step=g2');
  guideNet();
  mount();
  await loaded('a.ts');
  await userEvent.setup().click(await screen.findByRole('link', { name: `Open a.ts at ${headerOf('h2')}` }));
  expect(parseRoute(location.search)).toEqual({ review: 'r-1', view: 'guided', step: 'g2', file: 'a.ts', side: 'new', lines: '20-23' });
});

test('Comment on hunk inside a step posts a hunk anchor, and the new thread renders under the hunk', async () => {
  at('&step=g2');
  const created = thread({ id: 't-3', anchor: linesAnchor({ file: 'a.ts', hunkId: 'h2', startLine: 3, endLine: 3 }), messages: [{ id: 1, author: { kind: 'human' }, body: 'on the hunk', at: '', round: 1, citations: [] }] });
  const net = guideNet({}, { 'POST api/reviews/r-1/threads': { thread: created, fileSig: { path: 'a.ts', sig: 'sa2' } } });
  mount();
  await loaded('a.ts');
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Comment on hunk' }));
  await user.type(screen.getByLabelText('Message'), 'on the hunk');
  await user.click(screen.getByRole('button', { name: 'Post' }));
  await waitFor(() => expect(net.calls.find((c) => c.method === 'POST')?.body).toEqual({ anchor: { kind: 'hunk', hunkId: 'h2' }, kind: 'comment', body: 'on the hunk' }));
  const grid = screen.getByRole('grid', { name: /Changes in a\.ts/ });
  expect(await within(grid).findByText('on the hunk')).toBeTruthy();
});
