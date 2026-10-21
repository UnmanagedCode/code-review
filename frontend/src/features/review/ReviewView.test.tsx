import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test } from 'vitest';
import { WIDE_QUERY } from '@/lib/useMediaQuery';
import { installFakeEventSource } from '@/test/fakeEventSource';
import { installMedia } from '@/test/fakeMedia';
import { parseRoute } from '@/lib/route';
import { diffFile, fileState, refusal, review, thread } from '@/test/fixtures';
import { stubFetch } from '@/test/stubFetch';
import { ReviewView, XL_QUERY } from './ReviewView';

beforeEach(() => installFakeEventSource());

function world(status: 'open' | 'closed') {
  const file = diffFile({ threads: [thread()] });
  stubFetch({
    'GET api/reviews/r-1': { review: review({ status }), files: [fileState()], rounds: [], submissions: [], outdatedThreads: [] },
    'GET api/reviews/r-1/diff': (u: URL) => (u.searchParams.has('commit')
      ? { readOnly: true, commit: { sha: 'abc1234', subject: 's' }, files: [{ ...file, threads: [] }] }
      : { review: review({ status }), files: [file] }),
    'GET api/reviews/r-1/commits': { commits: [{ sha: 'abc1234', short: 'abc1234', author: 'a', date: 'd', subject: 's', merge: false }] },
    'GET api/reviews/r-1/file': { path: 'src/a.ts', side: 'new', total: 4, lines: [] },
    'GET api/sessions': { sessions: [] },
  });
}

test('an open review offers gutter selection and a reply box', async () => {
  world('open');
  history.replaceState(null, '', '?review=r-1&file=src%2Fa.ts');
  render(<ReviewView id="r-1" />);
  expect(await screen.findByRole('grid')).toBeTruthy();
  expect(document.querySelector('[data-cell]')).not.toBeNull();
  expect(screen.getAllByLabelText('Reply').length).toBeGreaterThan(0);
});

// Invariant: the resize handle exists only where the thread panel sits beside the diff.
test.each([[false, false], [true, true]])('with xl=%s the threads panel handle is present=%s', async (xl, present) => {
  installMedia({ [WIDE_QUERY]: true, [XL_QUERY]: xl });
  world('open');
  history.replaceState(null, '', '?review=r-1&file=src%2Fa.ts&view=threads');
  render(<ReviewView id="r-1" />);
  // Below xl the panel is an open modal sheet, which hides the rest from the accessibility tree.
  await screen.findByRole('grid', { hidden: true });
  expect(!!screen.queryByRole('separator', { name: 'Resize threads panel', hidden: true })).toBe(present);
});

test('a closed review is read-only: no gutter selection and no reply box', async () => {
  world('closed');
  history.replaceState(null, '', '?review=r-1&file=src%2Fa.ts');
  render(<ReviewView id="r-1" />);
  await screen.findByRole('article', { name: 'comment thread' });
  expect(document.querySelector('[data-cell]')).toBeNull();
  expect(screen.queryByLabelText('Reply')).toBeNull();
});

test('the commit-filter view is read-only even on an open review', async () => {
  world('open');
  history.replaceState(null, '', '?review=r-1&file=src%2Fa.ts&commit=abc1234');
  render(<ReviewView id="r-1" />);
  await screen.findByRole('grid');
  await waitFor(() => expect(screen.queryByRole('group', { name: 'Hunk verdict' })).toBeNull());
  expect(document.querySelector('[data-cell]')).toBeNull();
  expect(screen.queryByLabelText('Reply')).toBeNull();
});

/** A two-round range review: round 1 had `old.ts`, round 2 (current) has `src/a.ts`. */
function twoRounds(roundView: unknown = undefined) {
  const rounds = [1, 2].map((n) => ({ n, headSha: `${n}`.repeat(40), baseSha: 'b'.repeat(40), createdAt: '', submittedAt: null }));
  const then = diffFile({ path: 'old.ts', hunks: [{ ...diffFile().hunks[0], verdict: null }], threads: [thread({ anchor: { ...thread().anchor, file: 'old.ts' }, laterMessages: 1 })] });
  return stubFetch({
    'GET api/reviews/r-1': { review: review({ round: 2 }), files: [fileState()], rounds, submissions: [], outdatedThreads: [] },
    'GET api/reviews/r-1/rounds/1': roundView ?? { readOnly: true, round: rounds[0], files: [fileState({ path: 'old.ts', verdicts: null })], counts: { open: 1, resolved: 0, outdated: 0 }, outdatedThreads: [] },
    'GET api/reviews/r-1/diff': (u: URL) => (u.searchParams.get('round') === '1'
      ? { readOnly: true, round: rounds[0], files: [then] }
      : { review: review({ round: 2 }), files: [diffFile({ threads: [thread()] })] }),
    'GET api/reviews/r-1/commits': { commits: [{ sha: 'abc1234', short: 'abc1234', author: 'a', date: 'd', subject: 's', merge: false }] },
    'GET api/reviews/r-1/file': { path: 'old.ts', side: 'new', total: 4, lines: [] },
    'GET api/sessions': { sessions: [] },
  });
}

test('a past round shows that round\'s files, read-only: no verdicts, no Accept file, no gutter selection, no reply box, no commit filter', async () => {
  const net = twoRounds();
  history.replaceState(null, '', '?review=r-1&round=1&file=old.ts');
  render(<ReviewView id="r-1" />);
  await screen.findByRole('article', { name: 'comment thread' });
  expect(net.count('GET api/reviews/r-1/rounds/1')).toBeGreaterThan(0);
  expect(screen.getAllByText('old.ts').length).toBeGreaterThan(0);
  expect(screen.queryByRole('group', { name: 'Hunk verdict' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Accept file' })).toBeNull();
  expect(document.querySelector('[data-cell]')).toBeNull();
  expect(screen.queryByLabelText('Reply')).toBeNull();
  expect(screen.queryByRole('combobox', { name: 'Commit filter' })).toBeNull();
  expect((screen.getByRole('combobox', { name: 'Round' }) as HTMLSelectElement).value).toBe('1');
  const diffs = net.calls.filter((c) => c.url.pathname.endsWith('/diff'));
  expect(diffs.every((c) => c.url.searchParams.get('round') === '1')).toBe(true);
});

test('"Back to current round" leaves the round view and the round\'s file', async () => {
  twoRounds();
  history.replaceState(null, '', '?review=r-1&round=1&file=old.ts');
  render(<ReviewView id="r-1" />);
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Back to current round' }));
  expect(parseRoute(location.search)).toEqual({ review: 'r-1' });
  expect(await screen.findByRole('combobox', { name: 'Commit filter' })).toBeTruthy();
});

test('round= naming the current round is dropped from the URL, and the live view shows', async () => {
  const net = twoRounds();
  history.replaceState(null, '', '?review=r-1&round=2');
  render(<ReviewView id="r-1" />);
  await waitFor(() => expect(parseRoute(location.search)).toEqual({ review: 'r-1' }));
  expect(net.count('GET api/reviews/r-1/rounds/2')).toBe(0);
  expect(screen.queryByRole('button', { name: 'Back to current round' })).toBeNull();
});

test('a refused round view shows its error in place of the file tree, with the round picker still there', async () => {
  twoRounds(refusal('SNAPSHOT_GONE', 410));
  history.replaceState(null, '', '?review=r-1&round=1');
  render(<ReviewView id="r-1" />);
  expect(await screen.findByRole('button', { name: /retry/i })).toBeTruthy();
  expect(screen.getByRole('combobox', { name: 'Round' })).toBeTruthy();
});

test('a closed review in a past-round view says it is closed but offers no Reopen', async () => {
  stubFetch({
    'GET api/reviews/r-1': { review: review({ round: 2, status: 'closed' }), files: [fileState()], rounds: [1, 2].map((n) => ({ n, headSha: `${n}`.repeat(40), baseSha: 'b'.repeat(40), createdAt: '', submittedAt: null })), submissions: [], outdatedThreads: [] },
    'GET api/reviews/r-1/rounds/1': { readOnly: true, round: { n: 1, headSha: '1'.repeat(40), baseSha: 'b'.repeat(40), createdAt: '', submittedAt: null }, files: [fileState({ verdicts: null })], counts: { open: 0, resolved: 0, outdated: 0 }, outdatedThreads: [] },
    'GET api/reviews/r-1/commits': { commits: [] },
    'GET api/sessions': { sessions: [] },
  });
  history.replaceState(null, '', '?review=r-1&round=1');
  render(<ReviewView id="r-1" />);
  await screen.findByText('This review is closed.');
  expect(screen.queryByRole('button', { name: 'Reopen' })).toBeNull();
});
