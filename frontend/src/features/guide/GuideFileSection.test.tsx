import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { act } from '@testing-library/react';
import { navigate } from '@/lib/route';
import { diffFile, groupAnchor, hunk, linesAnchor, lines, review, thread } from '@/test/fixtures';
import { GuideHarness, guideNet, headerOf, sampleGuide } from '@/test/guideWorld';
import { GuideStepView } from './GuideStepView';

const at = (q: string) => history.replaceState(null, '', `?review=r-1&view=guided${q}`);
const mount = (guide = sampleGuide()) => render(<GuideHarness guide={guide}><GuideStepView /></GuideHarness>);
const bar = (path: string) => screen.findByRole('button', { name: new RegExp(`^${path.replace('.', '\\.')}`) });
const grids = () => screen.queryAllByRole('grid');

/** The fixture hunk's rows renumbered to start at `start`, so a hunk's lines agree with its newStart. */
const linesFrom = (start: number) => lines('c1 c2 d3 a3 c4').map((l) => ({ ...l, old: l.old === null ? null : l.old + start - 1, new: l.new === null ? null : l.new + start - 1 }));
const hunkAt = (id: string, start: number) => hunk({ id, header: headerOf(id), oldStart: start, newStart: start, lines: linesFrom(start) });

/** a.ts's diff carries the given line threads (h1 spans lines 1-4, h2 lines 20-23). */
const withThreads = (...threads: ReturnType<typeof thread>[]) => ({
  'GET api/reviews/r-1/diff': (u: URL) => {
    const path = u.searchParams.get('file')!;
    const hunks = path === 'a.ts'
      ? [hunkAt('h1', 1), hunkAt('h2', 20)]
      : [hunkAt('h3', 1), hunkAt('h4', 30)];
    return { review: review(), files: [diffFile({ path, sig: path === 'a.ts' ? 'sa' : 'sb', hunks, threads: path === 'a.ts' ? threads : [] })] };
  },
});

test('every file bar starts collapsed, with its body hidden', async () => {
  // Invariant: a step opens with no hunk on screen; each bar is a disclosure button wired to a hidden body.
  at('&step=g1');
  guideNet();
  mount();
  for (const p of ['a.ts', 'b.ts']) {
    const b = await bar(p);
    expect(b.getAttribute('aria-expanded')).toBe('false');
    expect((document.getElementById(b.getAttribute('aria-controls')!) as HTMLElement).hidden).toBe(true);
  }
  expect(grids()).toHaveLength(0);
  expect(screen.queryAllByRole('group', { name: 'Hunk verdict' })).toHaveLength(0);
});

test('a bar toggles its hunks on click', async () => {
  // Invariant: clicking the bar shows the file's hunks and flips aria-expanded; clicking again hides them.
  at('&step=g1');
  guideNet();
  mount();
  const user = userEvent.setup();
  const b = await bar('a.ts');
  await user.click(b);
  expect(b.getAttribute('aria-expanded')).toBe('true');
  expect(await within(screen.getByRole('region', { name: 'a.ts' })).findByRole('grid')).toBeTruthy();
  await user.click(b);
  expect(b.getAttribute('aria-expanded')).toBe('false');
  expect(grids()).toHaveLength(0);
});

test('a bar toggles from the keyboard with Enter and Space', async () => {
  // Invariant: the bar is keyboard-operable, not only pointer-operable.
  at('&step=g1');
  guideNet();
  mount();
  const user = userEvent.setup();
  const b = await bar('a.ts');
  b.focus();
  await user.keyboard('{Enter}');
  expect(b.getAttribute('aria-expanded')).toBe('true');
  await user.keyboard(' ');
  expect(b.getAttribute('aria-expanded')).toBe('false');
});

test('the collapsed bar reports hunk count, pending or decided, and open threads', async () => {
  // Invariant: the bar carries what the reader needs to pick a file: it follows hunk verdicts and the file's open line threads.
  at('&step=g1');
  guideNet({}, withThreads(thread({ id: 't-5', anchor: linesAnchor({ file: 'a.ts', hunkId: 'h1', startLine: 2, endLine: 2 }) })));
  mount(sampleGuide({}, { hunks: [{ id: 'h1', file: 'a.ts', verdict: 'pending' }, { id: 'h3', file: 'b.ts', verdict: 'accepted' }] }));
  const a = await bar('a.ts');
  expect(a.textContent).toContain('1 hunk · 1 pending');
  await waitFor(() => expect(a.textContent).toContain('1 open thread'));
  const b = await bar('b.ts');
  expect(b.textContent).toContain('1 hunk · decided');
  expect(b.textContent).not.toContain('thread');
});

test('an open file stays open across a remount, per step', async () => {
  // Invariant: "Open in file" unmounts the step; coming back must find the file open, and other steps keep their own state.
  at('&step=g1');
  guideNet();
  const first = mount();
  await userEvent.setup().click(await bar('a.ts'));
  first.unmount();
  const second = mount();
  expect((await bar('a.ts')).getAttribute('aria-expanded')).toBe('true');
  second.unmount();
  at('&step=g2');
  mount();
  expect((await bar('a.ts')).getAttribute('aria-expanded')).toBe('false');
});

test('a thread route into a file opens it on the first render of the card, and the bar still collapses it', async () => {
  // Invariant: the routed line thread's card mounts inside an open file so its scroll lands on a visible card; the user can still collapse.
  const visible: boolean[] = [];
  const scroll = vi.fn(function (this: Element) { visible.push(!this.closest('[hidden]')); });
  const orig = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = scroll;
  try {
    at('&step=g2&thread=t-5');
    const t = thread({ id: 't-5', anchor: linesAnchor({ file: 'a.ts', hunkId: 'h2', startLine: 21, endLine: 21 }) });
    guideNet({}, withThreads(t));
    mount();
    const b = await bar('a.ts');
    await waitFor(() => expect(b.getAttribute('aria-expanded')).toBe('true'));
    await waitFor(() => expect(scroll).toHaveBeenCalled());
    expect(visible.every(Boolean)).toBe(true);
    await userEvent.setup().click(b);
    expect(b.getAttribute('aria-expanded')).toBe('false');
    await new Promise((r) => setTimeout(r, 20));
    expect(b.getAttribute('aria-expanded')).toBe('false');
  } finally { Element.prototype.scrollIntoView = orig; }
});

test('a routed group thread leaves the file bars collapsed', async () => {
  // Invariant: group threads render above the files, so routing to one does not open any file.
  at('&step=g1&thread=t-9');
  const t = thread({ id: 't-9', anchor: groupAnchor({ groupId: 'g1' }) });
  guideNet();
  render(<GuideHarness guide={sampleGuide({ threads: [t] })}><GuideStepView /></GuideHarness>);
  for (const p of ['a.ts', 'b.ts']) expect((await bar(p)).getAttribute('aria-expanded')).toBe('false');
});

test('arriving again at a routed thread re-opens its file after the user collapsed it', async () => {
  // Invariant: each fresh arrival at a routed line thread force-opens its file, even if it was collapsed during an earlier visit.
  const visible: boolean[] = [];
  const orig = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (this: Element) { visible.push(!this.closest('[hidden]')); };
  try {
    at('&step=g1&thread=t-5');
    const line = thread({ id: 't-5', anchor: linesAnchor({ file: 'a.ts', hunkId: 'h1', startLine: 2, endLine: 2 }) });
    const group = thread({ id: 't-9', anchor: groupAnchor({ groupId: 'g1' }) });
    guideNet({}, withThreads(line));
    render(<GuideHarness guide={sampleGuide({ threads: [group] })}><GuideStepView /></GuideHarness>);
    const b = await bar('a.ts');
    await waitFor(() => expect(b.getAttribute('aria-expanded')).toBe('true'));
    await userEvent.setup().click(b);
    expect(b.getAttribute('aria-expanded')).toBe('false');
    act(() => navigate({ thread: 't-9' }));
    expect(b.getAttribute('aria-expanded')).toBe('false');
    visible.length = 0;
    act(() => navigate({ thread: 't-5' }));
    await waitFor(() => expect(b.getAttribute('aria-expanded')).toBe('true'));
    await waitFor(() => expect(visible.length).toBeGreaterThan(0));
    expect(visible.every(Boolean)).toBe(true);
  } finally { Element.prototype.scrollIntoView = orig; }
});

test('a line thread on another hunk of the same file does not open the file', async () => {
  // Invariant: only a routed thread that touches a hunk shown in this step opens that file; g2 shows h2, the thread sits on h1.
  at('&step=g2&thread=t-5');
  const other = thread({ id: 't-5', anchor: linesAnchor({ file: 'a.ts', hunkId: 'h1', startLine: 3, endLine: 3 }) });
  guideNet({}, withThreads(other));
  mount();
  const b = await bar('a.ts');
  await waitFor(() => expect(b.textContent).toContain('1 hunk'));
  await new Promise((r) => setTimeout(r, 20));
  expect(b.getAttribute('aria-expanded')).toBe('false');
});
