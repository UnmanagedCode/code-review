import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { WIDE_QUERY } from '@/lib/useMediaQuery';
import { installFakeEventSource } from '@/test/fakeEventSource';
import { installMedia } from '@/test/fakeMedia';
import { parseRoute } from '@/lib/route';
import { diffFile, fileState, refusal, review, thread } from '@/test/fixtures';
import { stubFetch } from '@/test/stubFetch';
import { ReviewView } from './ReviewView';

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

// Invariant: every wide layout is one resizable side pane beside the diff; the threads live in its tabs, not a dialog.
test('wide: one side pane holds the threads, with one resize handle and no dialog or Threads button', async () => {
  installMedia({ [WIDE_QUERY]: true });
  world('open');
  history.replaceState(null, '', '?review=r-1&file=src%2Fa.ts&view=threads');
  render(<ReviewView id="r-1" />);
  await screen.findByRole('grid');
  expect(screen.getAllByRole('separator', { name: 'Resize side pane' })).toHaveLength(1);
  expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
  expect(screen.queryByRole('button', { name: /^Threads/ })).toBeNull();
  const threads = within(screen.getByRole('tablist', { name: 'Review pane' })).getByRole('tab', { name: /^Threads/ });
  expect(threads.getAttribute('aria-selected')).toBe('true');
  expect(within(screen.getByRole('tabpanel', { name: /^Threads/ })).getByRole('tablist', { name: 'Thread filter' })).toBeTruthy();
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

test('a past round shows that round\'s files, read-only: no verdicts, no Accept file, no gutter selection, no reply box', async () => {
  const net = twoRounds();
  history.replaceState(null, '', '?review=r-1&round=1&file=old.ts&view=history');
  render(<ReviewView id="r-1" />);
  await screen.findByRole('article', { name: 'comment thread' });
  expect(net.count('GET api/reviews/r-1/rounds/1')).toBeGreaterThan(0);
  expect(screen.getAllByText('old.ts').length).toBeGreaterThan(0);
  expect(screen.queryByRole('group', { name: 'Hunk verdict' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Accept file' })).toBeNull();
  expect(document.querySelector('[data-cell]')).toBeNull();
  expect(screen.queryByLabelText('Reply')).toBeNull();
  // History marks the viewed round; its commits sit under the current round, picking one leaves the past view.
  const hist = screen.getByRole('navigation', { name: 'History' });
  expect(within(hist).getByRole('link', { name: /^Round 1 · / }).getAttribute('aria-current')).toBe('true');
  const current = within(hist).getByRole('link', { name: /^Round 2 \(current\)/ }).closest('li')!;
  expect(within(current).getByRole('link', { name: /abc1234/ })).toBeTruthy();
  const diffs = net.calls.filter((c) => c.url.pathname.endsWith('/diff'));
  expect(diffs.every((c) => c.url.searchParams.get('round') === '1')).toBe(true);
});

test('"Back to current round" leaves the round view and the round\'s file', async () => {
  twoRounds();
  history.replaceState(null, '', '?review=r-1&round=1&file=old.ts');
  render(<ReviewView id="r-1" />);
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Back to current round' }));
  expect(parseRoute(location.search)).toEqual({ review: 'r-1' });
  expect(await screen.findByRole('button', { name: /^Round 2 · 2222222 — show history/ })).toBeTruthy();
});

test('round= naming the current round is dropped from the URL, and the live view shows', async () => {
  const net = twoRounds();
  history.replaceState(null, '', '?review=r-1&round=2');
  render(<ReviewView id="r-1" />);
  await waitFor(() => expect(parseRoute(location.search)).toEqual({ review: 'r-1' }));
  expect(net.count('GET api/reviews/r-1/rounds/2')).toBe(0);
  expect(screen.queryByRole('button', { name: 'Back to current round' })).toBeNull();
});

test('a refused round view shows its error in the Files tab, with History still reachable', async () => {
  twoRounds(refusal('SNAPSHOT_GONE', 410));
  history.replaceState(null, '', '?review=r-1&round=1');
  render(<ReviewView id="r-1" />);
  const files = await screen.findByRole('tabpanel', { name: 'Files' });
  expect(await within(files).findByRole('button', { name: /retry/i })).toBeTruthy();
  await userEvent.setup().click(screen.getByRole('tab', { name: 'History' }));
  expect(within(screen.getByRole('navigation', { name: 'History' })).getByRole('link', { name: /^Round 1 · / }).getAttribute('aria-current')).toBe('true');
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
  expect(screen.getByRole('button', { name: /^Round 1 → 3 · read-only/ })).toBeTruthy();
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
  expect(await screen.findByRole('button', { name: /^Round 3 · 3333333 — show history/ })).toBeTruthy();
});

// Invariant: on a phone the open file's Retry is the only recovery from a failed comparison, so it refetches it.
test('Retry in the file pane of a failed comparison fetches the comparison again', async () => {
  const rounds = [1, 2].map((n) => ({ n, headSha: `${n}`.repeat(40), baseSha: 'b'.repeat(40), createdAt: '', submittedAt: null }));
  const net = stubFetch({
    'GET api/reviews/r-1': { review: review({ round: 2 }), files: [fileState()], rounds, submissions: [], outdatedThreads: [] },
    'GET api/reviews/r-1/compare': refusal('SNAPSHOT_GONE', 410),
    'GET api/sessions': { sessions: [] },
  });
  installMedia({ [WIDE_QUERY]: false }); // phone: the open file replaces the pane, so its Retry is the only one
  history.replaceState(null, '', '?review=r-1&compare=1..2&file=src%2Fa.ts');
  render(<ReviewView id="r-1" />);
  const retry = await screen.findByRole('button', { name: 'Retry' });
  await waitFor(() => expect(net.count('GET api/reviews/r-1/compare')).toBeGreaterThan(0));
  const before = net.count('GET api/reviews/r-1/compare');
  await userEvent.setup().click(retry);
  await waitFor(() => expect(net.count('GET api/reviews/r-1/compare')).toBe(before + 1));
});

/** Two files; src/a.ts is open and holds t-1, src/b.ts holds t-2. */
function twoFiles() {
  const one = { open: 1, resolved: 0, outdated: 0 };
  const b = (id: string) => thread({ id, anchor: { ...thread().anchor, file: 'src/b.ts', startLine: 3, endLine: 3 } });
  return stubFetch({
    'GET api/reviews/r-1': { review: review(), files: [fileState({ threads: one }), fileState({ path: 'src/b.ts', threads: one })], rounds: [], submissions: [], outdatedThreads: [] },
    'GET api/reviews/r-1/diff': (u: URL) => ({
      review: review(),
      files: u.searchParams.get('file') === 'src/b.ts'
        ? [diffFile({ path: 'src/b.ts', threads: [b('t-2')] })]
        : [diffFile({ threads: [thread()] })],
    }),
    'GET api/sessions': { sessions: [] },
  });
}

const panelCardOf = (link: string) => waitFor(() => {
  const card = screen.getAllByRole('article').find((a) => within(a).queryByRole('button', { name: link }));
  if (!card) throw new Error(`no card with ${link}`);
  return card;
});

// Invariant: Focus on a thread of another file switches to that file, and the thread's card there scrolls itself into view.
// Invariant: the pane stays on its Threads tab across the jump.
test('cross-file Focus loads the other file and focuses its thread there, the Threads tab still selected', async () => {
  const scrolled: Element[] = [];
  const orig = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this); };
  try {
    const net = twoFiles();
    installMedia({ [WIDE_QUERY]: true });
    history.replaceState(null, '', '?review=r-1&file=src%2Fa.ts');
    render(<ReviewView id="r-1" />);
    await screen.findAllByRole('article');
    // The Threads tab's All filter lists t-2 from the thread index.
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: /^Threads/ }));
    await user.click(await screen.findByRole('tab', { name: /^All/ }));
    const t2 = await panelCardOf('src/b.ts · L3 (new)');
    await user.click(within(t2).getByRole('button', { name: 'Focus' }));
    expect(parseRoute(location.search)).toMatchObject({ file: 'src/b.ts', thread: 't-2', view: 'threads' });
    const grid = await screen.findByRole('grid', { name: 'Changes in src/b.ts' });
    expect(screen.getByRole('tab', { name: /^Threads/ }).getAttribute('aria-selected')).toBe('true');
    await waitFor(() => expect(scrolled.some((el) => grid.contains(el) && el.getAttribute('aria-label') === 'comment thread')).toBe(true));
  } finally { Element.prototype.scrollIntoView = orig; }
});

/** A range review at round 3 whose t-9 went outdated in round 3 (its last located anchor is round 2). */
function outdatedWorld(files: ReturnType<typeof diffFile>[], unread = 0) {
  const rounds = [1, 2, 3].map((n) => ({ n, headSha: `${n}`.repeat(40), baseSha: 'b'.repeat(40), createdAt: '', submittedAt: null }));
  const t9 = thread({ id: 't-9', status: 'outdated', unread, anchor: { ...thread().anchor, round: 2, startLine: 3, endLine: 3 } });
  const from = { ...thread({ id: 't-9', anchor: { ...thread().anchor, side: 'old', round: 2 } }), placement: 'from', outdatedIn: 3 };
  return stubFetch({
    'GET api/reviews/r-1': { review: review({ kind: 'range', round: 3 }), files: [fileState()], rounds, submissions: [], outdatedThreads: [t9] },
    'GET api/reviews/r-1/compare': (u: URL) => ({
      readOnly: true, from: rounds[Number(u.searchParams.get('from')) - 1], to: rounds[Number(u.searchParams.get('to')) - 1],
      files: files.map((f) => ({ ...f, threads: [from] })), counts: { open: 1, resolved: 0, outdated: 0 }, unplaced: [],
    }),
    'GET api/reviews/r-1/diff': { review: review({ kind: 'range', round: 3 }), files: [diffFile()] },
    'GET api/reviews/r-1/file': { path: 'src/a.ts', side: 'old', total: 4, lines: [{ n: 3, text: 'x' }] },
    'POST api/reviews/r-1/read': { review: review() },
    'GET api/sessions': { sessions: [] },
  });
}

// Invariant: an outdated thread's location link opens the comparison of its last located round with the next, thread in place.
test('an outdated thread\'s link opens comparison 2..3 with the thread in place', async () => {
  const net = outdatedWorld([diffFile()]);
  installMedia({ [WIDE_QUERY]: true });
  history.replaceState(null, '', '?review=r-1');
  render(<ReviewView id="r-1" />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('tab', { name: /^Threads/ }));
  await user.click(await screen.findByRole('tab', { name: /^Outdated/ }));
  await user.click(await screen.findByRole('button', { name: 'src/a.ts · L3 (new)' }));
  expect(await screen.findByText('Exit comparison')).toBeTruthy();
  expect(parseRoute(location.search)).toMatchObject({ compare: '2..3', file: 'src/a.ts', side: 'old', thread: 't-9', view: 'threads' });
  expect(screen.getByRole('tab', { name: /^Threads/ }).getAttribute('aria-selected')).toBe('true');
  const cmp = net.calls.filter((c) => c.url.pathname.endsWith('/compare'));
  expect(cmp.length).toBeGreaterThan(0);
  expect(cmp.every((c) => c.url.searchParams.get('from') === '2' && c.url.searchParams.get('to') === '3')).toBe(true);
  expect((await screen.findAllByRole('article', { name: 'comment thread' })).length).toBeGreaterThan(0);
});

// Invariant: when the comparison lacks the thread's file, the cited excerpt reads round R's head (side=old) rather than nothing.
test('an outdated thread whose file is not in the comparison shows the excerpt at its round', async () => {
  const net = outdatedWorld([]);
  installMedia({ [WIDE_QUERY]: true });
  history.replaceState(null, '', '?review=r-1');
  render(<ReviewView id="r-1" />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('tab', { name: /^Threads/ }));
  await user.click(await screen.findByRole('tab', { name: /^Outdated/ }));
  await user.click(await screen.findByRole('button', { name: 'src/a.ts · L3 (new)' }));
  expect(await screen.findByRole('table', { name: 'Excerpt of src/a.ts' })).toBeTruthy();
  expect(net.calls.some((c) => c.url.pathname.endsWith('/file') && c.url.searchParams.get('round') === '2')).toBe(true);
});

// Invariant: repeating the same jump pushes one history entry (navigate ignores an identical route).
// The location link stays mounted after the jump, unlike Focus, so it can be clicked twice.
test('clicking a location link twice pushes one history entry', async () => {
  const push = vi.spyOn(history, 'pushState');
  twoFiles();
  installMedia({ [WIDE_QUERY]: true });
  history.replaceState(null, '', '?review=r-1&file=src%2Fa.ts&view=threads');
  render(<ReviewView id="r-1" />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('tab', { name: /^All/ }));
  const link = within(await panelCardOf('src/b.ts · L3 (new)')).getByRole('button', { name: 'src/b.ts · L3 (new)' });
  await user.click(link);
  await waitFor(() => expect(parseRoute(location.search)).toMatchObject({ file: 'src/b.ts', thread: 't-2' }));
  await user.click(link);
  expect(push).toHaveBeenCalledTimes(1);
  push.mockRestore();
});

// Invariant: in the real Outdated tab the card unmounts on the jump (the panel becomes the comparison's), and the unread
// outdated thread is still marked read.
test('jumping from the Outdated tab to an unread outdated thread marks it read', async () => {
  const net = outdatedWorld([diffFile()], 2);
  installMedia({ [WIDE_QUERY]: true });
  history.replaceState(null, '', '?review=r-1&view=threads');
  render(<ReviewView id="r-1" />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('tab', { name: /^Outdated/ }));
  await user.click(await screen.findByRole('button', { name: 'src/a.ts · L3 (new)' }));
  await waitFor(() => expect(net.calls.find((c) => c.method === 'POST' && c.url.pathname.endsWith('/read'))?.body).toEqual({ threadId: 't-9' }));
});

// Invariant: a phone shows the pane or the diff, never a dialog; the diff's Threads button opens the pane's Threads tab.
test('phone: the pane without a file, the diff with one, and its Threads button lands on the Threads tab', async () => {
  installMedia({ [WIDE_QUERY]: false });
  stubFetch({
    'GET api/reviews/r-1': { review: review({ unread: 2 }), files: [fileState()], rounds: [], submissions: [], outdatedThreads: [] },
    'GET api/reviews/r-1/diff': { review: review({ unread: 2 }), files: [diffFile({ threads: [thread()] })] },
    'GET api/sessions': { sessions: [] },
  });
  history.replaceState(null, '', '?review=r-1');
  render(<ReviewView id="r-1" />);
  expect(await screen.findByRole('tablist', { name: 'Review pane' })).toBeTruthy();
  expect(screen.queryByRole('grid')).toBeNull();
  const user = userEvent.setup();
  await user.click(within(screen.getByRole('navigation', { name: 'Files' })).getByTitle('src/a.ts'));
  await screen.findByRole('grid');
  expect(screen.queryByRole('tablist', { name: 'Review pane' })).toBeNull();
  const button = screen.getByRole('button', { name: /^Threads/ });
  expect(button.textContent).toContain('2');
  await user.click(button);
  expect(parseRoute(location.search)).toEqual({ review: 'r-1', view: 'threads' });
  expect((await screen.findByRole('tab', { name: /^Threads/ })).getAttribute('aria-selected')).toBe('true');
  expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
});

// Invariant: Back from the diff returns to the pane on the tab it was left from.
test('phone: Back from the diff keeps the pane tab', async () => {
  installMedia({ [WIDE_QUERY]: false });
  world('open');
  history.replaceState(null, '', '?review=r-1&file=src%2Fa.ts&view=threads');
  render(<ReviewView id="r-1" />);
  await screen.findByRole('grid');
  await userEvent.setup().click(screen.getByRole('button', { name: 'Back to files' }));
  expect(parseRoute(location.search)).toEqual({ review: 'r-1', view: 'threads' });
  expect((await screen.findByRole('tab', { name: /^Threads/ })).getAttribute('aria-selected')).toBe('true');
  expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
});
