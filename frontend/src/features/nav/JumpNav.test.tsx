import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test } from 'vitest';
import { parseRoute } from '@/lib/route';
import { WIDE_QUERY } from '@/lib/useMediaQuery';
import { installBridge } from '@/test/fakeBridge';
import { installMedia } from '@/test/fakeMedia';
import { diffFile, fileState, groupAnchor, linesAnchor, message, review, thread, threadDigest } from '@/test/fixtures';
import { renderDiff } from '@/test/renderCtx';
import { stubFetch } from '@/test/stubFetch';
import { FileDiff } from '@/features/diff/FileDiff';
import { SubmitControls } from '@/features/submit/SubmitControls';
import { ThreadCard } from '@/features/threads/ThreadCard';

const route = () => parseRoute(location.search);
const at = (file: string, line: number) => linesAnchor({ file, startLine: line, endLine: line });
const th = (id: string, anchor: ReturnType<typeof at> | ReturnType<typeof groupAnchor> | { kind: 'review' }, state: 'awaiting-human' | 'unsent') =>
  threadDigest({ id, state, anchor: anchor as never });
// Place order: a1 a2 b1 grp rv. Needs-you first: a1 a2 | b1 grp rv.
const openThreads = [th('a1', at('a.ts', 1), 'awaiting-human'), th('a2', at('a.ts', 5), 'awaiting-human'), th('b1', at('b.ts', 1), 'unsent'), th('grp', groupAnchor({ groupId: 'g1' }), 'unsent'), th('rv', { kind: 'review' }, 'unsent')];
const files = [fileState({ path: 'a.ts' }), fileState({ path: 'b.ts' }), fileState({ path: 'c.ts' })];
const mount = (url: string, over = {}) => {
  history.replaceState(null, '', url);
  return renderDiff(<FileDiff />, diffFile({ path: 'a.ts' }), { files, openThreads, ...over });
};
const keys = (k: string) => userEvent.setup().keyboard(k);

beforeEach(() => { installMedia({ [WIDE_QUERY]: true }); });

// Invariant: n walks the open threads, needs-you first and then place order, to each thread's place; stepping within one file replaces the history entry, a step to another file pushes.
test("n opens the next thread's place; a same-file step replaces history, a cross-file step pushes", async () => {
  mount('?file=a.ts');
  const base = history.length;
  await keys('n');
  expect(route()).toEqual({ file: 'a.ts', side: 'new', thread: 'a1' });
  await keys('n');
  expect(route()).toEqual({ file: 'a.ts', side: 'new', thread: 'a2' });
  expect(history.length).toBe(base);
  await keys('n');
  expect(route()).toEqual({ file: 'b.ts', side: 'new', thread: 'b1' });
  expect(history.length).toBe(base + 1);
  await keys('n');
  expect(route()).toEqual({ view: 'guided', step: 'g1', thread: 'grp' });
  await keys('n');
  expect(route()).toEqual({ view: 'threads', thread: 'rv', step: 'g1' });
  const end = location.search;
  await keys('n');
  expect(location.search).toBe(end);
  await keys('p');
  expect(route().thread).toBe('grp');
});

// Invariant: the position reads off the routed thread and counts every open thread of the review.
test('Thread k of N follows route.thread and N equals the open threads', () => {
  mount('?file=a.ts&thread=a2');
  expect(screen.getByText('Thread 2 of 5 open')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Next thread' })).toBeTruthy();
});

// Invariant: u jumps to the next thread that needs the reviewer and says so, without moving, when none other does.
test('u goes to the next needs-you thread, and stays put when there is none', async () => {
  mount('?file=a.ts&thread=a1');
  await keys('u');
  expect(route().thread).toBe('a2');
  await keys('u');
  expect(route().thread).toBe('a1');
});

// Invariant: with no thread needing the reviewer u moves nowhere.
test('u does nothing when no thread needs the reviewer', async () => {
  mount('?file=a.ts&thread=b1', { openThreads: openThreads.slice(2) });
  const before = location.search;
  await keys('u');
  expect(location.search).toBe(before);
});

// Invariant: a phone never shows the pane beside a file, so stepping to a review thread leaves the file.
test('on a phone, stepping to a review thread leaves the file', async () => {
  installMedia({ [WIDE_QUERY]: false });
  mount('?file=b.ts&thread=grp');
  await keys('n');
  expect(route()).toEqual({ view: 'threads', thread: 'rv' });
});

// Invariant: ] and [ walk the files in the order the Files tab shows them (directories first), not the server's path order, and stop at the ends; the header chevrons do the same.
test('] and [ and the header chevrons follow tree order and stop at the ends', async () => {
  const tree = [fileState({ path: 'src/config.js' }), fileState({ path: 'src/routes/x.js' })];
  history.replaceState(null, '', '?file=src/routes/x.js');
  renderDiff(<FileDiff />, diffFile({ path: 'src/routes/x.js' }), { files: tree });
  expect(screen.getByText('File 1 of 2')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Previous file' }) as HTMLButtonElement).disabled).toBe(true);
  await keys(']');
  expect(route().file).toBe('src/config.js');
  const end = location.search;
  await keys(']');
  expect(location.search).toBe(end);
  await keys('[[');
  expect(route().file).toBe('src/routes/x.js');
  await userEvent.setup().click(screen.getByRole('button', { name: 'Next file' }));
  expect(route().file).toBe('src/config.js');
});

// Invariant: keys typed into a field are text, never navigation or verdicts.
test('typing n/p/u/j/]/a/? into the composer changes neither the route nor any verdict', async () => {
  const net = stubFetch({});
  mount('?file=a.ts&thread=a2');
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Comment on file' }));
  const box = await screen.findByRole('textbox');
  await user.click(box);
  const before = location.search;
  await user.keyboard('npuj][[kax?');
  expect((box as HTMLTextAreaElement).value).toBe('npuj][kax?');
  expect(location.search).toBe(before);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(net.calls).toEqual([]);
});

// Invariant: ? lists exactly the shortcuts that act now (v is there because a file is open; / and s are not, since no tree or submit control is mounted here), plus the grid's line-selection keys; ? and Esc close it and focus returns to the opener.
test('? opens the overlay listing exactly the registered shortcuts plus the line-selection keys; ? and Esc close it; focus returns', async () => {
  mount('?file=a.ts');
  const user = userEvent.setup();
  const opener = screen.getByRole('button', { name: 'Keyboard shortcuts' });
  opener.focus();
  await user.keyboard('?');
  const dialog = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
  const listed = within(dialog).getAllByRole('term').map((t) => t.textContent);
  expect(listed).toEqual(expect.arrayContaining(['Next open thread', 'Next thread that needs you', 'Next hunk', 'Next file', 'Overview', 'Mark the file viewed', 'Move the line selection']));
  for (const absent of ['Filter files', 'Submit round']) expect(listed).not.toContain(absent);
  await user.keyboard('?');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(opener);
  await user.keyboard('?');
  await screen.findByRole('dialog');
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(opener);
});

// Invariant: a past-round view is read-only history: no thread stepping (stepper hidden, n/p/u inert), while file stepping still works.
test('in a round view the thread stepper and n/p/u are absent; file stepping remains', async () => {
  mount('?file=a.ts&round=1', { round: 1 });
  expect(screen.queryByRole('button', { name: 'Next thread' })).toBeNull();
  const before = location.search;
  await keys('npu');
  expect(location.search).toBe(before);
  await keys(']');
  expect(route().file).toBe('b.ts');
});

// Invariant: o leaves the open file for the overview and keeps the pane tab.
test('o leaves the file and keeps the pane tab', async () => {
  mount('?file=a.ts&thread=a1&view=threads');
  await keys('o');
  expect(route()).toEqual({ view: 'threads' });
});

// Invariant: s does what Submit round does: it opens the recap and sends nothing; where Submit is disabled the key is inert.
test('s opens the recap and sends nothing; a closed review ignores it', async () => {
  const bridge = installBridge();
  const net = stubFetch({ 'POST api/reviews/r-1/submissions/preview': { recap: { round: 1, kind: 'range', nothingToSubmit: false, hunks: null, undecided: [], files: null, outgoing: [], needsYou: [], waiting: 0, text: 'PREVIEW' } } });
  const view = renderDiff(<><FileDiff /><SubmitControls onNoRecipient={() => {}} /></>, diffFile({ path: 'a.ts' }), { files });
  await userEvent.setup().keyboard('s');
  expect(await screen.findByRole('dialog')).toBeTruthy();
  expect(bridge.sendPrompt).not.toHaveBeenCalled();
  expect(net.calls.map((c) => c.url.pathname)).toEqual(['/api/reviews/r-1/submissions/preview']);
  view.unmount();
  stubFetch({});
  renderDiff(<><FileDiff /><SubmitControls onNoRecipient={() => {}} /></>, diffFile({ path: 'a.ts' }), { files, review: review({ status: 'closed' }) });
  await userEvent.setup().keyboard('s');
  expect(screen.queryByRole('dialog')).toBeNull();
});

// Invariant: the card a step routed to takes focus (Tab then reaches its reply box); a card reached by a link does not.
test('a stepper-routed card takes focus; a link-routed card does not', async () => {
  const t = thread({ id: 'a1', anchor: at('a.ts', 2) as never, messages: [message()] });
  const file = diffFile({ path: 'a.ts', threads: [t] });
  history.replaceState(null, '', '?file=a.ts&thread=a1');
  const linked = renderDiff(<FileDiff />, file, { files, openThreads });
  expect(screen.getByRole('article', { name: /thread/ })).toBeTruthy();
  expect(document.activeElement).toBe(document.body);
  linked.unmount();
  history.replaceState(null, '', '?file=a.ts');
  renderDiff(<FileDiff />, file, { files, openThreads });
  await keys('n');
  expect(route().thread).toBe('a1');
  expect(document.activeElement).toBe(screen.getByRole('article', { name: /thread/ }));
  expect(screen.getByText('thread 1 of 5')).toBeTruthy();
});

// Invariant: a step's focus request for a line thread goes to the card beside the code, not to the pane's copy of the same thread, whatever the mount order; a review thread has no diff card, so its pane card takes it.
test('the focus of a stepped-to line thread lands on the diff card, not the pane copy', async () => {
  const t = thread({ id: 'a1', anchor: at('a.ts', 2) as never, messages: [message()] });
  history.replaceState(null, '', '?file=a.ts');
  renderDiff(<><div data-testid="pane"><ThreadCard thread={t} /></div><FileDiff /></>, diffFile({ path: 'a.ts', threads: [t] }), { files, openThreads });
  await keys('n');
  expect(route().thread).toBe('a1');
  const focused = document.activeElement as HTMLElement;
  expect(focused.tagName).toBe('ARTICLE');
  expect(screen.getByTestId('pane').contains(focused)).toBe(false);
  expect(focused.closest('[role=grid]')).not.toBeNull();
});

test('a review thread has no diff card: the pane card takes the focus', async () => {
  const t = thread({ id: 'rv', anchor: { kind: 'review' } as never, messages: [message()] });
  history.replaceState(null, '', '?file=a.ts');
  renderDiff(<><div data-testid="pane"><ThreadCard thread={t} /></div><FileDiff /></>, diffFile({ path: 'a.ts' }), { files, openThreads: [openThreads[4]] });
  await keys('n');
  expect(document.activeElement).toBe(screen.getByTestId('pane').querySelector('article'));
});
