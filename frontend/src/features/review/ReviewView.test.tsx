import { render, screen, waitFor, within } from '@testing-library/react';
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

/** A three-round range review (round 3 current) and its comparisons: t-1 on old 3 (round 1) and new 3 (round 3). */
function threeRounds(kind: 'range' | 'commit' = 'range', current = 3) {
  const rounds = Array.from({ length: current }, (_, i) => ({ n: i + 1, headSha: `${i + 1}`.repeat(40), baseSha: 'b'.repeat(40), createdAt: '', submittedAt: null }));
  const copy = (placement: 'from' | 'to', side: 'old' | 'new', round: number) =>
    ({ ...thread({ anchor: { ...thread().anchor, side, round } }), placement, outdatedIn: null });
  const cmpFile = diffFile({ hunks: [{ ...diffFile().hunks[0], verdict: null }], threads: [copy('from', 'old', 1), copy('to', 'new', 3)] });
  return stubFetch({
    'GET api/reviews/r-1': { review: review({ kind, round: current }), files: [fileState()], rounds, submissions: [], outdatedThreads: [thread({ id: 't-9', status: 'outdated' })] },
    'GET api/reviews/r-1/compare': (u: URL) => ({
      readOnly: true, from: rounds[Number(u.searchParams.get('from')) - 1], to: rounds[Number(u.searchParams.get('to')) - 1],
      files: [cmpFile], counts: { open: 1, resolved: 0, outdated: 0 }, unplaced: [],
    }),
    'GET api/reviews/r-1/rounds/1': { readOnly: true, round: rounds[0], files: [fileState({ verdicts: null })], counts: { open: 0, resolved: 0, outdated: 0 }, outdatedThreads: [] },
    'GET api/reviews/r-1/diff': (u: URL) => (u.searchParams.has('commit')
      ? { readOnly: true, commit: { sha: 'abc1234', subject: 's' }, files: [{ ...diffFile(), threads: [] }] }
      : { review: review({ kind, round: current }), files: [diffFile({ threads: [thread()] })] }),
    'GET api/reviews/r-1/commits': { commits: [{ sha: 'abc1234', short: 'abc1234', author: 'a', date: 'd', subject: 's', merge: false }] },
    'GET api/reviews/r-1/file': { path: 'src/a.ts', side: 'new', total: 4, lines: [] },
    'GET api/sessions': { sessions: [] },
  });
}

// Invariant: a compare= URL loads the comparison (never the live diff) and offers no write of any kind.
test('a comparison lists its files and is read-only: no verdicts, Accept file, Submit, Refresh, reply box or gutter selection', async () => {
  const net = threeRounds();
  history.replaceState(null, '', '?review=r-1&compare=1..3&file=src%2Fa.ts');
  render(<ReviewView id="r-1" />);
  await screen.findAllByRole('article', { name: 'comment thread' });
  const cmp = net.calls.filter((c) => c.url.pathname.endsWith('/compare'));
  expect(cmp.length).toBeGreaterThan(0);
  expect(cmp.every((c) => c.url.searchParams.get('from') === '1' && c.url.searchParams.get('to') === '3')).toBe(true);
  expect(net.calls.filter((c) => c.url.pathname.endsWith('/diff'))).toEqual([]);
  // The tree counts each thread once, though the comparison holds two copies of it.
  const link = within(screen.getByRole('navigation', { name: 'Files' })).getByTitle('src/a.ts');
  expect(link.textContent).toContain('1 open, 0 resolved, 0 outdated');
  expect(screen.getByText('Exit comparison')).toBeTruthy();
  expect(screen.queryByRole('group', { name: 'Hunk verdict' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Accept file' })).toBeNull();
  expect(screen.queryByRole('button', { name: /Submit round/ })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Review actions' })).toBeNull();
  expect(screen.queryByLabelText('Reply')).toBeNull();
  expect(document.querySelector('[data-cell]')).toBeNull();
  expect(screen.queryByRole('combobox', { name: 'Commit filter' })).toBeNull();
});

// Invariant: a comparison the review cannot have is replaced out of the URL, and the live view shows.
test.each([
  ['from not before to', 'range', 3, '3..2'],
  ['equal rounds', 'range', 3, '2..2'],
  ['to past the current round', 'range', 3, '2..4'],
  ['a non-range review', 'commit', 3, '1..2'],
  ['a single round', 'range', 1, '1..2'],
] as const)('compare= naming %s is dropped from the URL', async (_what, kind, current, compare) => {
  const net = threeRounds(kind, current);
  history.replaceState(null, '', `?review=r-1&compare=${compare}`);
  render(<ReviewView id="r-1" />);
  await waitFor(() => expect(parseRoute(location.search)).toEqual({ review: 'r-1' }));
  expect(net.calls.some((c) => c.url.pathname.endsWith('/compare'))).toBe(false);
  expect(screen.queryByText('Exit comparison')).toBeNull();
});

// Invariant: commit= beats compare=: the commit filter's diff shows and the comparison is not loaded.
test('the commit filter beats a comparison', async () => {
  const net = threeRounds();
  history.replaceState(null, '', '?review=r-1&compare=1..3&commit=abc1234&file=src%2Fa.ts');
  render(<ReviewView id="r-1" />);
  await screen.findByRole('grid');
  expect(net.calls.some((c) => c.url.pathname.endsWith('/compare'))).toBe(false);
  expect(net.calls.some((c) => c.url.searchParams.get('commit') === 'abc1234')).toBe(true);
  expect(screen.queryByText('Exit comparison')).toBeNull();
});

// Invariant: a valid compare= beats round=, which is replaced out of the URL.
test('round= alongside a valid comparison is dropped, and the comparison shows', async () => {
  const net = threeRounds();
  history.replaceState(null, '', '?review=r-1&round=1&compare=1..3');
  render(<ReviewView id="r-1" />);
  await waitFor(() => expect(parseRoute(location.search)).toEqual({ review: 'r-1', compare: '1..3' }));
  expect(await screen.findByText('Exit comparison')).toBeTruthy();
  expect(net.count('GET api/reviews/r-1/rounds/1')).toBe(0);
  expect(screen.queryByRole('button', { name: 'Back to current round' })).toBeNull();
});

// Invariant: Exit comparison leaves the comparison and its file position for the live review.
test('Exit comparison clears the comparison and the file position', async () => {
  threeRounds();
  history.replaceState(null, '', '?review=r-1&compare=1..3&file=src%2Fa.ts&lines=3&side=old&thread=t-1');
  render(<ReviewView id="r-1" />);
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Exit comparison' }));
  expect(parseRoute(location.search)).toEqual({ review: 'r-1' });
  expect(await screen.findByRole('combobox', { name: 'Commit filter' })).toBeTruthy();
});
