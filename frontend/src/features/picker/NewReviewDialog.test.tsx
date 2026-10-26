import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { expect, test, vi } from 'vitest';
import { parseRoute } from '@/lib/route';
import { installBridge } from '@/test/fakeBridge';
import { parsePrefill } from '@/lib/prefill';
import { refusal, review } from '@/test/fixtures';
import { stubFetch } from '@/test/stubFetch';
import { NewReviewDialog } from './NewReviewDialog';

const commits = [{ sha: 'c'.repeat(40), short: 'ccccccc', author: 'a', date: 'd', subject: 'second', merge: false }, { sha: 'd'.repeat(40), short: 'ddddddd', author: 'a', date: 'd', subject: 'first', merge: false }];
function world(forkPoints = [{ ref: 'main', label: 'main (parent)', forkSha: 'f'.repeat(40) }], reused = false, sessions: unknown[] = []) {
  return stubFetch({
    'GET api/checkout': { checkout: { project: 'app', worktree: 'feature', path: '/x', branch: 'feature', headSha: 'h', dirty: false, exists: true }, forkPoints, worktrees: [] },
    'GET api/checkout/commits': { commits },
    'GET api/sessions': { sessions },
    'POST api/reviews': { review: review({ id: 'r-9' }), reused },
  });
}
const opened = (net: ReturnType<typeof world>) => net.calls.find((c) => c.method === 'POST')?.body;

test('range posts the fork-point shortcut as base', async () => {
  const net = world();
  const user = userEvent.setup();
  render(<NewReviewDialog project="app" worktree="feature" onClose={() => {}} />);
  await waitFor(() => expect(screen.getByRole('radio', { name: /main \(parent\)/ }).getAttribute('aria-checked')).toBe('true'));
  await user.click(screen.getByRole('button', { name: 'Open review' }));
  await waitFor(() => expect(opened(net)).toEqual({ project: 'app', worktree: 'feature', kind: 'range', base: 'main' }));
});

test('range posts a picked commit sha as base', async () => {
  const net = world();
  const user = userEvent.setup();
  render(<NewReviewDialog project="app" worktree="feature" onClose={() => {}} />);
  await user.click(await screen.findByRole('radio', { name: 'Another commit' }));
  await user.selectOptions(await screen.findByLabelText('Base commit'), 'd'.repeat(40));
  await user.click(screen.getByRole('button', { name: 'Open review' }));
  await waitFor(() => expect(opened(net)).toMatchObject({ kind: 'range', base: 'd'.repeat(40) }));
});

test('a main checkout without a fork point cannot submit until a base is picked', async () => {
  world([]);
  render(<NewReviewDialog project="app" worktree={null} onClose={() => {}} />);
  const open = await screen.findByRole('button', { name: 'Open review' });
  expect((open as HTMLButtonElement).disabled).toBe(true);
});

test('commit posts the chosen sha; uncommitted posts neither base nor sha', async () => {
  const net = world();
  const user = userEvent.setup();
  const { unmount } = render(<NewReviewDialog project="app" worktree="feature" onClose={() => {}} />);
  await user.click(screen.getByRole('radio', { name: /One commit/ }));
  await user.selectOptions(await screen.findByLabelText('Commit'), 'c'.repeat(40));
  await user.click(screen.getByRole('button', { name: 'Open review' }));
  await waitFor(() => expect(opened(net)).toEqual({ project: 'app', worktree: 'feature', kind: 'commit', sha: 'c'.repeat(40) }));
  unmount();
  const net2 = world();
  render(<NewReviewDialog project="app" worktree="feature" onClose={() => {}} />);
  await user.click(screen.getByRole('radio', { name: /Uncommitted/ }));
  await user.click(screen.getByRole('button', { name: 'Open review' }));
  await waitFor(() => expect(opened(net2)).toEqual({ project: 'app', worktree: 'feature', kind: 'uncommitted' }));
});

test('a reused review is announced and navigated to', async () => {
  world(undefined, true);
  const info = vi.spyOn(toast, 'info').mockImplementation(() => '');
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(<NewReviewDialog project="app" worktree="feature" onClose={onClose} />);
  await waitFor(() => expect((screen.getByRole('button', { name: 'Open review' }) as HTMLButtonElement).disabled).toBe(false));
  await user.click(screen.getByRole('button', { name: 'Open review' }));
  await waitFor(() => expect(location.search).toContain('review=r-9'));
  expect(onClose).toHaveBeenCalled();
  expect(info).toHaveBeenCalledWith('Opened the existing review');
});

test('opening the new review drops every review-scoped key of the one before, round included', async () => {
  history.replaceState(null, '', '?project=app&worktree=feature&review=r-1&round=1&file=a.js&thread=t-1&view=new');
  world();
  const user = userEvent.setup();
  render(<NewReviewDialog project="app" worktree="feature" onClose={() => {}} />);
  await waitFor(() => expect((screen.getByRole('button', { name: 'Open review' }) as HTMLButtonElement).disabled).toBe(false));
  await user.click(screen.getByRole('button', { name: 'Open review' }));
  await waitFor(() => expect(parseRoute(location.search)).toEqual({ project: 'app', worktree: 'feature', review: 'r-9' }));
});

const sess = (sessionId: string, label: string, live = true) => ({ sessionId, project: 'app', worktree: 'feature', label: label || null, status: live ? 'idle' : 'exited', live, conductor: false, conducted: false, attached: live });
const sessions = [sess('s-1', 'Fix login'), sess('s-2', 'Other work'), sess('s-dead', 'Gone', false), sess('s-bare', '')];
const fields = () => ({ title: (screen.getByLabelText('Title (optional)') as HTMLInputElement).value, recipient: (screen.getByLabelText('Recipient session') as HTMLSelectElement).value });

test('a live active session prefills the recipient and its title, and both are posted', async () => {
  installBridge({ sessionId: 's-1', project: 'app', worktree: 'feature' });
  const net = world(undefined, false, sessions);
  const user = userEvent.setup();
  render(<NewReviewDialog project="app" worktree="feature" onClose={() => {}} />);
  await waitFor(() => expect(fields()).toEqual({ title: 'Fix login', recipient: 's-1' }));
  await waitFor(() => expect((screen.getByRole('button', { name: 'Open review' }) as HTMLButtonElement).disabled).toBe(false));
  await user.click(screen.getByRole('button', { name: 'Open review' }));
  await waitFor(() => expect(opened(net)).toMatchObject({ title: 'Fix login', recipient: 's-1' }));
});

test('a dead active session prefills only the title; the recipient stays Default', async () => {
  installBridge({ sessionId: 's-dead', project: 'app', worktree: 'feature' });
  world(undefined, false, sessions);
  render(<NewReviewDialog project="app" worktree="feature" onClose={() => {}} />);
  await waitFor(() => expect(fields()).toEqual({ title: 'Gone', recipient: '' }));
});

test('a live session without a title still becomes the recipient, with the title left blank', async () => {
  installBridge({ sessionId: 's-bare', project: 'app', worktree: 'feature' });
  world(undefined, false, sessions);
  render(<NewReviewDialog project="app" worktree="feature" onClose={() => {}} />);
  await waitFor(() => expect(fields()).toEqual({ title: '', recipient: 's-bare' }));
});

test('an unlisted, null or absent active session leaves both fields blank', async () => {
  for (const session of [{ sessionId: 'unlisted', project: 'app', worktree: 'feature' }, null, undefined]) {
    const net = world(undefined, false, sessions);
    installBridge(session);
    const { unmount } = render(<NewReviewDialog project="app" worktree="feature" onClose={() => {}} />);
    await waitFor(() => expect(net.count('GET api/sessions')).toBe(1));
    await screen.findByRole('option', { name: 'Fix login' });
    expect(fields()).toEqual({ title: '', recipient: '' });
    unmount();
  }
});

test('an edited title is kept when the active session changes, while the recipient follows', async () => {
  const bridge = installBridge({ sessionId: 's-1', project: 'app', worktree: 'feature' });
  world(undefined, false, sessions);
  const user = userEvent.setup();
  render(<NewReviewDialog project="app" worktree="feature" onClose={() => {}} />);
  await waitFor(() => expect(fields().recipient).toBe('s-1'));
  const title = screen.getByLabelText('Title (optional)');
  await user.clear(title);
  await user.type(title, 'Mine');
  act(() => bridge.emit({ sessionId: 's-2', project: 'app', worktree: 'feature' }));
  await waitFor(() => expect(fields()).toEqual({ title: 'Mine', recipient: 's-2' }));
});

test('choosing Default for the recipient pins it against a later session change', async () => {
  const bridge = installBridge({ sessionId: 's-1', project: 'app', worktree: 'feature' });
  world(undefined, false, sessions);
  const user = userEvent.setup();
  render(<NewReviewDialog project="app" worktree="feature" onClose={() => {}} />);
  await waitFor(() => expect(fields().recipient).toBe('s-1'));
  await user.selectOptions(screen.getByLabelText('Recipient session'), '');
  act(() => bridge.emit({ sessionId: 's-2', project: 'app', worktree: 'feature' }));
  await waitFor(() => expect(fields().title).toBe('Other work'));
  expect(fields().recipient).toBe('');
});

test('a title typed and a recipient picked before the sessions arrive are not overwritten by the prefill', async () => {
  installBridge({ sessionId: 's-1', project: 'app', worktree: 'feature' });
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const sessionsResponder = async () => { await gate; return { sessions }; };
  stubFetch({
    'GET api/checkout': { checkout: { project: 'app', worktree: 'feature', path: '/x', branch: 'feature', headSha: 'h', dirty: false, exists: true }, forkPoints: [{ ref: 'main', label: 'main (parent)', forkSha: 'f'.repeat(40) }], worktrees: [] },
    'GET api/checkout/commits': { commits },
    'GET api/sessions': sessionsResponder,
  });
  const user = userEvent.setup();
  render(<NewReviewDialog project="app" worktree="feature" onClose={() => {}} />);
  await user.type(screen.getByLabelText('Title (optional)'), 'Early');
  await user.selectOptions(screen.getByLabelText('Recipient session'), '');
  release();
  await screen.findByRole('option', { name: 'Fix login' });
  await waitFor(() => expect(fields()).toEqual({ title: 'Early', recipient: '' }));
});

// --- Prefill from a link (`view=new&range=…` / `&sha=…`) ---

const HEAD = 'e'.repeat(40);
const OLD = '0'.repeat(40);
const commit = (sha: string, subject: string) => ({ sha, short: sha.slice(0, 7), author: 'a', date: 'd', subject, merge: false });
/** The checkout is at HEAD; `api/checkout/commit` resolves `refs` (a ref missing from it is REF_UNKNOWN, `-x` BAD_REF). */
function linkWorld(refs: Record<string, ReturnType<typeof commit>> = {}) {
  const table = { HEAD: commit(HEAD, 'tip'), [HEAD]: commit(HEAD, 'tip'), main: commit('f'.repeat(40), 'fork'), [OLD.slice(0, 7)]: commit(OLD, 'ancient'), ...refs };
  return stubFetch({
    'GET api/checkout': { checkout: { project: 'app', worktree: 'feature', path: '/x', branch: 'feature', headSha: HEAD, dirty: false, exists: true }, forkPoints: [{ ref: 'main', label: 'main (parent)', forkSha: 'f'.repeat(40) }], worktrees: [] },
    'GET api/checkout/commits': { commits },
    'GET api/sessions': { sessions: [sess('s-1', 'Fix login')] },
    'GET api/checkout/commit': (u: URL) => {
      const ref = u.searchParams.get('ref')!;
      if (ref.startsWith('-')) return refusal('BAD_REF', 400);
      return table[ref] ? { commit: table[ref] } : refusal('REF_UNKNOWN', 404);
    },
    'POST api/reviews': { review: review({ id: 'r-9' }), reused: false },
  });
}
const renderLink = (link: { range?: string; sha?: string }) =>
  render(<NewReviewDialog project="app" worktree="feature" prefill={parsePrefill(link)} onClose={() => {}} />);
const openButton = () => screen.getByRole('button', { name: 'Open review' }) as HTMLButtonElement;
const ready = () => waitFor(() => expect(openButton().disabled).toBe(false));
const checked = (name: RegExp | string) => screen.getByRole('radio', { name }).getAttribute('aria-checked');

// Invariant: a fork-point base stays the ref, exactly as if the human had picked that radio.
test('a link whose base is a fork point selects that radio and posts the ref', async () => {
  const net = linkWorld();
  const user = userEvent.setup();
  renderLink({ range: 'main...HEAD' });
  await ready();
  expect(checked(/main \(parent\)/)).toBe('true');
  await user.click(openButton());
  await waitFor(() => expect(opened(net)).toEqual({ project: 'app', worktree: 'feature', kind: 'range', base: 'main' }));
});

// Invariant: a base outside the listed commits is still selectable and visible, and is posted as the full sha the server resolved.
test('a sha base older than the listed commits selects Another commit, shows it, and posts the full sha', async () => {
  const net = linkWorld();
  const user = userEvent.setup();
  renderLink({ range: `${OLD.slice(0, 7)}..${HEAD}` });
  await ready();
  expect(checked('Another commit')).toBe('true');
  const picker = screen.getByLabelText('Base commit') as HTMLSelectElement;
  expect(picker.value).toBe(OLD);
  expect(screen.getByRole('option', { name: '0000000 ancient' })).toBeTruthy();
  await user.click(openButton());
  await waitFor(() => expect(opened(net)).toEqual({ project: 'app', worktree: 'feature', kind: 'range', base: OLD }));
});

// Invariant: a range review always ends at the checkout's HEAD, so a link ending elsewhere is refused, not silently retargeted.
test('a range ending anywhere but HEAD shows why, keeps the defaults, and submits the default base', async () => {
  const net = linkWorld({ older: commit('9'.repeat(40), 'not head') });
  const user = userEvent.setup();
  renderLink({ range: `${OLD.slice(0, 7)}...older` });
  await ready();
  expect(screen.getByRole('alert').textContent).toMatch(/could not be used.*9999999.*HEAD \(eeeeeee\)/);
  expect(checked(/main \(parent\)/)).toBe('true');
  expect(checked(/Range/)).toBe('true');
  await user.click(openButton());
  await waitFor(() => expect(opened(net)).toMatchObject({ kind: 'range', base: 'main' }));
});

// Invariant: a ref the server refuses degrades to the default dialog with the refusal's wording; nothing throws.
test('an unknown or malformed ref shows the refusal and keeps the defaults', async () => {
  for (const link of [{ range: 'nope...HEAD' }, { sha: '-x' }, { range: 'main' }, { range: 'main...HEAD', sha: 'abc' }]) {
    linkWorld();
    const { unmount } = renderLink(link);
    await ready();
    expect(screen.getByRole('alert').textContent, JSON.stringify(link)).toMatch(/This link could not be used/);
    expect(checked(/Range/)).toBe('true');
    expect(checked(/main \(parent\)/)).toBe('true');
    unmount();
  }
  linkWorld();
  const { unmount } = renderLink({ range: 'nope...HEAD' });
  expect((await screen.findByRole('alert')).textContent).toContain('That ref does not exist in this checkout: "nope"');
  unmount();
  linkWorld();
  renderLink({ sha: '-x' });
  expect((await screen.findByRole('alert')).textContent).toContain('That is not a valid git ref');
});

test('a commit link selects One commit and posts the resolved sha', async () => {
  const net = linkWorld();
  const user = userEvent.setup();
  renderLink({ sha: OLD.slice(0, 7) });
  await ready();
  expect(checked(/One commit/)).toBe('true');
  expect((screen.getByLabelText('Commit') as HTMLSelectElement).value).toBe(OLD);
  await user.click(openButton());
  await waitFor(() => expect(opened(net)).toEqual({ project: 'app', worktree: 'feature', kind: 'commit', sha: OLD }));
});

// Invariant: a link never opens a review by itself and never chooses the recipient: both stay the human's.
test('nothing is posted before the click, and the recipient is never taken from the link', async () => {
  history.replaceState(null, '', '?project=app&worktree=feature&view=new&range=main...HEAD&recipient=s-1');
  const net = linkWorld();
  renderLink({ range: 'main...HEAD' });
  await ready();
  await new Promise((r) => setTimeout(r, 20));
  expect(net.count('POST api/reviews')).toBe(0);
  expect(fields().recipient).toBe('');
});

test('while the link resolves the controls give way to a spinner and Open review is disabled', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const net = linkWorld();
  const inner = net.fn.getMockImplementation()!;
  net.fn.mockImplementation(async (input, init) => {
    if (String(input).startsWith('api/checkout/commit?')) await gate;
    return inner(input, init);
  });
  renderLink({ range: 'main...HEAD' });
  expect(await screen.findByRole('status')).toBeTruthy();
  expect(screen.queryByRole('radio', { name: /Range/ })).toBeNull();
  expect(openButton().disabled).toBe(true);
  release();
  await ready();
  expect(screen.queryByRole('status')).toBeNull();
});

// Invariant: an unknown project or worktree is said, not shown as an empty form that can be submitted.
test('an unknown checkout shows the refusal and disables Open review, with or without a link', async () => {
  for (const prefill of [null, parsePrefill({ range: 'main...HEAD' })]) {
    stubFetch({
      'GET api/checkout': refusal('PROJECT_UNKNOWN', 404),
      'GET api/checkout/commits': refusal('PROJECT_UNKNOWN', 404),
      'GET api/checkout/commit': refusal('PROJECT_UNKNOWN', 404),
      'GET api/sessions': { sessions: [] },
    });
    const { unmount } = render(<NewReviewDialog project="ghost" worktree={null} prefill={prefill} onClose={() => {}} />);
    expect((await screen.findByRole('alert')).textContent).toContain('Project unknown');
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(openButton().disabled).toBe(true);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    unmount();
  }
});
