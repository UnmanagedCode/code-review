import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test } from 'vitest';
import { installBridge } from '@/test/fakeBridge';
import { stubFetch } from '@/test/stubFetch';
import { parseRoute } from '@/lib/route';
import { CheckoutBar } from './CheckoutBar';

const checkout = { checkout: { project: 'app', worktree: null, path: '/x', branch: 'main', headSha: 'h', dirty: false, exists: true }, forkPoints: [], worktrees: [{ worktreeName: 'w1', branch: 'w1' }, { worktreeName: 'w2', branch: 'w2' }, { worktreeName: 'w3', branch: 'w3' }] };
const projects = { projects: [{ name: 'alpha' }, { name: 'app' }, { name: 'zed' }] };
const placesOf = (places: unknown) => [/^GET api\/sessions\/[^/?]+\/places$/, places] as [RegExp, unknown];
const world = (places: unknown = { places: [{ project: 'zed', main: false, worktrees: [] }, { project: 'ghost', main: true, worktrees: [] }, { project: 'app', main: true, worktrees: ['w3', 'w1'] }] }) =>
  stubFetch([[/^GET api\/projects$/, projects], [/^GET api\/checkout\?/, checkout], placesOf(places)]);
const renderBar = () => render(<CheckoutBar route={parseRoute('?project=app')} />);
const group = (select: HTMLElement, name: string) => within(select).queryByRole('group', { name });
const texts = (el: HTMLElement | null) => Array.from(el?.querySelectorAll('option') ?? []).map((o) => o.textContent);
const allTexts = (el: HTMLElement) => Array.from(el.querySelectorAll('option')).map((o) => o.textContent);

beforeEach(() => { history.replaceState(null, '', '?project=app'); });

test('with an active session the project select leads with its projects in place order, skipping unlisted ones', async () => {
  installBridge({ sessionId: 's-1', project: 'app', worktree: null });
  world();
  renderBar();
  const select = await screen.findByLabelText('Project');
  await waitFor(() => expect(group(select, 'Active session')).not.toBeNull());
  expect(texts(group(select, 'Active session'))).toEqual(['zed', 'app']);
  expect(texts(group(select, 'Other projects'))).toEqual(['alpha']);
});

test('the worktree select pins the place worktrees, with Main checkout when the place is on main', async () => {
  installBridge({ sessionId: 's-1', project: 'app', worktree: null });
  world();
  renderBar();
  const select = await screen.findByLabelText('Worktree');
  await waitFor(() => expect(group(select, 'Active session')).not.toBeNull());
  expect(texts(group(select, 'Active session'))).toEqual(['Main checkout', 'w3', 'w1']);
  expect(texts(group(select, 'Other worktrees'))).toEqual(['w2']);
});

test('Main checkout stays out of the pinned group when the place is not on main', async () => {
  installBridge({ sessionId: 's-1', project: 'app', worktree: null });
  world({ places: [{ project: 'app', main: false, worktrees: ['w2'] }] });
  renderBar();
  const select = await screen.findByLabelText('Worktree');
  await waitFor(() => expect(group(select, 'Active session')).not.toBeNull());
  expect(texts(group(select, 'Active session'))).toEqual(['w2']);
  expect(texts(group(select, 'Other worktrees'))).toEqual(['Main checkout', 'w1', 'w3']);
});

test('without a bridge both selects are flat and the places endpoint is never asked', async () => {
  const net = world();
  renderBar();
  const select = await screen.findByLabelText('Project');
  await waitFor(() => expect(allTexts(select)).toEqual(['alpha', 'app', 'zed']));
  expect(within(select).queryByRole('group')).toBeNull();
  const wt = screen.getByLabelText('Worktree');
  await waitFor(() => expect(allTexts(wt)).toEqual(['Main checkout', 'w1', 'w2', 'w3']));
  expect(net.calls.some((c) => c.url.pathname.endsWith('/places'))).toBe(false);
});

test('a null session, a failed places request and unlisted places all leave the selects flat', async () => {
  installBridge(null);
  const net = world();
  const { unmount } = renderBar();
  await waitFor(() => expect(allTexts(screen.getByLabelText('Project'))).toEqual(['alpha', 'app', 'zed']));
  expect(net.calls.some((c) => c.url.pathname.endsWith('/places'))).toBe(false);
  unmount();

  installBridge({ sessionId: 's-1', project: 'app', worktree: null });
  world(new Response('{}', { status: 500 }));
  const failed = renderBar();
  await waitFor(() => expect(allTexts(screen.getByLabelText('Project'))).toEqual(['alpha', 'app', 'zed']));
  expect(within(screen.getByLabelText('Project')).queryByRole('group')).toBeNull();
  failed.unmount();

  const net3 = world({ places: [{ project: 'ghost', main: true, worktrees: [] }] });
  renderBar();
  await waitFor(() => expect(net3.count('GET api/sessions/s-1/places')).toBe(1));
  await waitFor(() => expect(allTexts(screen.getByLabelText('Project'))).toEqual(['alpha', 'app', 'zed']));
  expect(within(screen.getByLabelText('Project')).queryByRole('group')).toBeNull();
});

test('a change of active session refetches places for the new id', async () => {
  const bridge = installBridge({ sessionId: 's-1', project: 'app', worktree: null });
  const net = stubFetch([
    [/^GET api\/projects$/, projects], [/^GET api\/checkout\?/, checkout],
    [/places$/, (url: URL) => ({ places: [{ project: url.pathname.includes('s-2') ? 'alpha' : 'zed', main: false, worktrees: [] }] })],
  ]);
  renderBar();
  const select = await screen.findByLabelText('Project');
  await waitFor(() => expect(texts(group(select, 'Active session'))).toEqual(['zed']));
  act(() => bridge.emit({ sessionId: 's-2', project: 'app', worktree: null }));
  await waitFor(() => expect(texts(group(select, 'Active session'))).toEqual(['alpha']));
  expect(net.count('GET api/sessions/s-2/places')).toBe(1);
});

test('picking an option inside the Active session group navigates to it', async () => {
  installBridge({ sessionId: 's-1', project: 'app', worktree: null });
  world();
  renderBar();
  const select = await screen.findByLabelText('Project');
  await waitFor(() => expect(group(select, 'Active session')).not.toBeNull());
  await userEvent.setup().selectOptions(select, 'zed');
  expect(location.search).toBe('?project=zed');
});
