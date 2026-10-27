import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { installBridge } from '@/test/fakeBridge';
import { installFakeEventSource } from '@/test/fakeEventSource';
import { diffFile, fileState, review, thread, linesAnchor } from '@/test/fixtures';
import { stubFetch } from '@/test/stubFetch';
import { App } from './App';

const rounds = (n: number) => Array.from({ length: n }, (_, i) => ({ n: i + 1, headSha: `${i + 1}`.repeat(40), baseSha: 'b'.repeat(40), createdAt: '', submittedAt: null }));

/** Two range reviews of `app`: r-1 at round 1, r-2 at round 2 with one open and one resolved thread. */
function world() {
  const r1 = review({ id: 'r-1', title: 'First review', round: 1, counts: { ...review().counts, threads: { open: 0, resolved: 0, outdated: 0 } } });
  const r2 = review({ id: 'r-2', title: 'Second review', round: 2, counts: { ...review().counts, threads: { open: 1, resolved: 1, outdated: 0 } } });
  const open = thread({ id: 't-7', anchor: linesAnchor({ file: 'a.js' }) });
  const done = thread({ id: 't-8', status: 'resolved', anchor: linesAnchor({ file: 'a.js', startLine: 4, endLine: 4 }) });
  const aFile = diffFile({ path: 'a.js', threads: [open, done] });
  const files2 = [fileState({ path: 'a.js', threads: { open: 1, resolved: 1, outdated: 0 } })];
  const compared = (from: number, to: number) => ({
    readOnly: true, from: rounds(2)[from - 1], to: rounds(2)[to - 1], files: [{ ...aFile, threads: [] }], counts: { open: 0, resolved: 0, outdated: 0 }, unplaced: [], reviewThreads: [],
  });
  return stubFetch([
    [/^GET api\/projects$/, { projects: [{ name: 'app' }, { name: 'other' }] }],
    [/^GET api\/checkout\?/, { checkout: { project: 'app', worktree: null, path: '/x', branch: 'main', headSha: 'h', dirty: false, exists: true }, forkPoints: [], worktrees: [] }],
    [/^GET api\/sessions/, { sessions: [] }],
    [/^GET api\/reviews\?/, { reviews: [r1, r2] }],
    [/^GET api\/reviews\/r-1$/, { review: r1, files: [fileState({ path: 'a.js' })], rounds: rounds(1), submissions: [], outdatedThreads: [], reviewThreads: [] }],
    [/^GET api\/reviews\/r-2$/, { review: r2, files: files2, rounds: rounds(2), submissions: [], outdatedThreads: [], reviewThreads: [] }],
    [/^GET api\/reviews\/r-1\/diff/, { review: r1, files: [diffFile({ path: 'a.js' })] }],
    [/^GET api\/reviews\/r-2\/diff/, { review: r2, files: [aFile] }],
    [/^GET api\/reviews\/r-2\/compare/, (u: URL) => compared(Number(u.searchParams.get('from')), Number(u.searchParams.get('to')))],
    [/^GET api\/reviews\/[^/]+\/file/, { path: 'a.js', side: 'old', total: 4, lines: [] }],
    [/^GET api\/reviews\/[^/]+\/commits/, { commits: [] }],
  ]);
}

/** Steers the open frame the way cc's bridge does: replace the URL, then a synthetic popstate. */
const steer = (search: string) => act(() => {
  history.replaceState(null, '', search);
  window.dispatchEvent(new PopStateEvent('popstate'));
});

// Invariant: a steer to another review is judged against that review's own rounds, never the previous review's.
test('a steer to another review keeps its compare= and shows that review', async () => {
  installFakeEventSource();
  world();
  history.replaceState(null, '', '?project=app&review=r-1&file=a.js&side=new');
  render(<App />);
  await screen.findByText('First review');
  steer('?project=app&review=r-2&compare=1..2&file=a.js&side=old&lines=3&thread=t-7');
  await screen.findByText('Second review');
  await act(async () => {});
  expect(location.search).toContain('compare=1..2');
});

// Invariant: a steer to another review starts with that review's own filters, not the previous review's.
test('a steer to another review starts with fresh review state', async () => {
  installFakeEventSource();
  world();
  const user = userEvent.setup();
  history.replaceState(null, '', '?project=app&review=r-2&view=threads&file=a.js&side=new');
  render(<App />);
  await screen.findByText('Second review');
  await user.click(await screen.findByRole('tab', { name: /^All/ }));
  await user.selectOptions(await screen.findByRole('combobox', { name: 'Status' }), 'resolved');
  steer('?project=app&review=r-1&view=threads');
  await screen.findByText('First review');
  steer('?project=app&review=r-2&view=threads');
  await screen.findByText('Second review');
  await user.click(await screen.findByRole('tab', { name: /^All/ }));
  expect((await screen.findByRole('combobox', { name: 'Status' }) as HTMLSelectElement).value).toBe('open');
});

// Invariant: a link that names a project keeps its review and thread when cc's first session names another checkout.
test('a link on a fresh load survives the bridge\'s first session', async () => {
  installFakeEventSource();
  world();
  installBridge({ sessionId: 's-1', project: 'other', worktree: null });
  history.replaceState(null, '', '?project=app&review=r-2&file=a.js&side=new&thread=t-7');
  render(<App />);
  await screen.findByText('Second review');
  await act(async () => {});
  expect(location.search).toBe('?project=app&review=r-2&file=a.js&side=new&thread=t-7');
  await waitFor(() => expect(screen.getByText('Second review')).toBeTruthy());
});
