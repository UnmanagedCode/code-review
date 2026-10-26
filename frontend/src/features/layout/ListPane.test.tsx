import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { App } from '@/App';
import { useRoute } from '@/lib/route';
import { WIDE_QUERY } from '@/lib/useMediaQuery';
import { installFakeEventSource } from '@/test/fakeEventSource';
import { installMedia } from '@/test/fakeMedia';
import { inboxItem } from '@/test/fixtures';
import { stubFetch } from '@/test/stubFetch';
import { ListPane } from './ListPane';

beforeEach(() => installFakeEventSource());

const world = () => stubFetch([
  [/^GET api\/projects$/, { projects: [{ name: 'app' }] }],
  [/^GET api\/checkout\?/, { checkout: { project: 'app', worktree: null, path: '/x', branch: 'main', headSha: 'h', dirty: false, exists: true }, forkPoints: [], worktrees: [] }],
  [/^GET api\/sessions/, { sessions: [] }],
  [/^GET api\/reviews\?/, { reviews: [] }],
  [/^GET api\/inbox$/, { reviews: [inboxItem({ title: 'In the inbox' })] }],
]);

function Pane() {
  return <ListPane route={useRoute()} follow={{ followingTitle: undefined, unfollowable: false }} />;
}

// Invariant: the Inbox tab is view=inbox written with replace; Checkout clears view, also with replace.
test('the Inbox tab writes view=inbox with replace, the Checkout tab clears it', async () => {
  world();
  history.replaceState(null, '', '?project=app');
  const push = vi.spyOn(history, 'pushState');
  const replace = vi.spyOn(history, 'replaceState');
  render(<Pane />);
  await screen.findByText('No reviews yet');
  const user = userEvent.setup();
  await user.click(screen.getByRole('tab', { name: 'Inbox' }));
  expect(location.search).toBe('?project=app&view=inbox');
  expect(await screen.findByText('In the inbox')).toBeTruthy();
  await user.click(screen.getByRole('tab', { name: 'Checkout' }));
  expect(location.search).toBe('?project=app');
  expect(replace).toHaveBeenCalledWith(null, '', '?project=app&view=inbox');
  expect(push).not.toHaveBeenCalled();
});

// Invariant: the Checkout panel stays mounted across a tab switch, so the review list's status select keeps its value; the Inbox panel mounts only while shown.
test('the Checkout panel keeps the review list status across a round trip; the inbox is fetched only while shown', async () => {
  const net = world();
  history.replaceState(null, '', '?project=app');
  render(<Pane />);
  await screen.findByText('No reviews yet');
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText('Status'), 'closed');
  expect(net.count('GET api/inbox')).toBe(0);
  await user.click(screen.getByRole('tab', { name: 'Inbox' }));
  await screen.findByText('In the inbox');
  await user.click(screen.getByRole('tab', { name: 'Checkout' }));
  expect((screen.getByLabelText('Status') as HTMLSelectElement).value).toBe('closed');
  expect(screen.queryByText('In the inbox')).toBeNull();
});

// Invariant: a narrow layout offers both tabs; its "Choose a project" placeholder belongs to the Checkout tab only.
test('a narrow layout has both tabs and shows the project placeholder on Checkout only', async () => {
  installMedia({ [WIDE_QUERY]: false });
  world();
  render(<App />);
  expect((await screen.findByText('Choose a project to review')).closest('[hidden]')).toBeNull();
  await userEvent.setup().click(screen.getByRole('tab', { name: 'Inbox' }));
  expect(await screen.findByText('In the inbox')).toBeTruthy();
  expect(screen.getByText('Choose a project to review').closest('[hidden]'), 'inside the hidden Checkout panel').not.toBeNull();
});
