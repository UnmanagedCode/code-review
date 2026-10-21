import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, test } from 'vitest';
import { buildRows } from '@/lib/diffRows';
import type { DiffFile } from '@/lib/types';
import { WIDE_QUERY } from '@/lib/useMediaQuery';
import type { FileDiffState } from '@/state/fileDiff';
import { ReviewProvider } from '@/state/reviewContext';
import { installMedia } from '@/test/fakeMedia';
import { installResizeObserver } from '@/test/fakeResizeObserver';
import { diffFile, fileState, hunk, message, thread } from '@/test/fixtures';
import { ctxValue, renderDiff } from '@/test/renderCtx';
import { stubFetch } from '@/test/stubFetch';
import { FileDiff } from './FileDiff';

let ro: ReturnType<typeof installResizeObserver>;
beforeEach(() => {
  installMedia({ [WIDE_QUERY]: true });
  ro = installResizeObserver();
  history.replaceState(null, '', '?file=src%2Fa.ts');
});

const SUMMARY = /@@ -1,4 \+1,4 @@.*accepted/;
const accepted = (over: Partial<DiffFile> = {}) => diffFile({ hunks: [hunk({ verdict: 'accepted' })], ...over });
const resolved = (over = {}) => thread({ status: 'resolved', messages: [message({ body: 'first line\nsecond' })], ...over });

/** Mounts FileDiff on `file`; `update` re-renders it with a new file the way a refetch would. */
function mount(file: DiffFile) {
  const r = renderDiff(<FileDiff />, file);
  ro.resize('all', 1000);
  const update = (f: DiffFile) => r.rerender(
    <ReviewProvider value={ctxValue({ files: [fileState({ path: f.path })], fileDiff: { file: f, rows: buildRows({ hunks: f.hunks, expansions: {}, texts: {}, total: null }), total: null } as unknown as FileDiffState })}>
      <FileDiff />
    </ReviewProvider>,
  );
  return { ...r, update };
}

describe.each(['inline', 'split'])('%s view', (view) => {
  beforeEach(() => localStorage.setItem('code-review:diffView', view));

  // Invariant: already-settled hunks render collapsed.
  test('an accepted hunk renders as a collapsed summary without its lines', () => {
    mount(accepted());
    expect(screen.getByRole('button', { name: SUMMARY }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('gridcell', { name: 'new line 3' })).toBeNull();
  });

  // Invariant: expand is view-only, never a verdict write.
  test('expanding a collapsed hunk shows its lines and writes nothing', () => {
    const net = stubFetch({});
    mount(accepted());
    fireEvent.click(screen.getByRole('button', { name: SUMMARY }));
    expect(screen.getByRole('gridcell', { name: 'new line 3' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Collapse hunk' }).getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Collapse hunk' }));
    expect(screen.queryByRole('gridcell', { name: 'new line 3' })).toBeNull();
    expect(net.calls).toEqual([]);
  });

  // Invariant: collapse follows the state change; un-accept expands; re-settling re-collapses.
  test('collapse follows the verdict', () => {
    const { update } = mount(diffFile());
    expect(screen.queryByRole('button', { name: SUMMARY })).toBeNull();
    update(accepted());
    expect(screen.getByRole('button', { name: SUMMARY })).toBeTruthy();
    update(diffFile());
    expect(screen.getByRole('gridcell', { name: 'new line 3' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Collapse hunk' })).toBeNull();
    update(accepted());
    fireEvent.click(screen.getByRole('button', { name: SUMMARY }));
    update(diffFile());
    update(accepted());
    expect(screen.getByRole('button', { name: SUMMARY }).getAttribute('aria-expanded')).toBe('false');
  });

  // Invariant: settling never unmounts an open selection/composer.
  test('accepting a hunk holding the selection keeps it expanded with its toolbar', () => {
    const { update } = mount(diffFile());
    fireEvent.pointerDown(screen.getByRole('gridcell', { name: 'new line 3' }), { button: 0, pointerType: 'touch' });
    expect(screen.getByRole('toolbar', { name: 'Selection' })).toBeTruthy();
    update(accepted());
    expect(screen.getByRole('gridcell', { name: 'new line 3' })).toBeTruthy();
    expect(screen.getByRole('toolbar', { name: 'Selection' })).toBeTruthy();
  });

  // Invariant: a hunk collapse never hides unresolved discussion.
  test('an open thread inside a collapsed hunk stays listed under its summary', () => {
    mount(accepted({ threads: [thread()] }));
    const summary = screen.getByRole('button', { name: SUMMARY });
    const card = screen.getByRole('article', { name: 'comment thread' });
    expect(summary.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // Invariant: resolved threads collapse; expand and reopen behave.
  test('a resolved thread is a summary that expands, and reopening shows the card', () => {
    const { update } = mount(diffFile({ threads: [resolved()] }));
    const summary = screen.getByRole('button', { name: /first line.*resolved/ });
    expect(within(summary).getByText('first line')).toBeTruthy();
    expect(summary.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('article')).toBeNull();
    fireEvent.click(summary);
    expect(screen.getByRole('article', { name: 'comment thread' })).toBeTruthy();
    update(diffFile({ threads: [thread({ status: 'open' })] }));
    expect(screen.getByRole('article', { name: 'comment thread' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /resolved/ })).toBeNull();
    update(diffFile({ threads: [resolved()] }));
    expect(screen.getByRole('button', { name: /first line.*resolved/ }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('article')).toBeNull();
  });

  // Invariant: collapsing never discards a reply draft.
  test('a reply draft survives its thread being resolved and collapsed', () => {
    const { update } = mount(diffFile({ threads: [thread()] }));
    fireEvent.change(screen.getByLabelText('Reply'), { target: { value: 'half typed' } });
    update(diffFile({ threads: [resolved()] }));
    expect(screen.queryByRole('article')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /resolved/ }));
    expect((screen.getByLabelText('Reply') as HTMLTextAreaElement).value).toBe('half typed');
  });

  // Invariant: navigation never lands on hidden content.
  test('a focused thread and a cited range are always expanded', () => {
    history.replaceState(null, '', '?file=src%2Fa.ts&thread=t-2');
    const { unmount } = mount(diffFile({ threads: [resolved({ id: 't-2' })] }));
    expect(screen.getByRole('article', { name: 'comment thread' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /resolved/ })).toBeNull();
    unmount();
    history.replaceState(null, '', '?file=src%2Fa.ts&lines=3');
    mount(accepted());
    expect(screen.getByRole('gridcell', { name: 'new line 3' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: SUMMARY })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Collapse hunk' })).toBeNull();
  });

  // Invariant: overrides are in memory only (reset on reload and file switch).
  test('an expanded hunk collapses again after a reload or a file switch', () => {
    const first = mount(accepted());
    fireEvent.click(screen.getByRole('button', { name: SUMMARY }));
    first.unmount();
    const { update } = mount(accepted());
    expect(screen.getByRole('button', { name: SUMMARY }).getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: SUMMARY }));
    update(accepted({ path: 'src/b.ts' }));
    update(accepted());
    expect(screen.getByRole('button', { name: SUMMARY }).getAttribute('aria-expanded')).toBe('false');
  });

  // Invariant: the summary is data → DOM, never markup.
  test('a resolved summary shows its raw first line as text', () => {
    const { container } = mount(diffFile({ threads: [resolved({ messages: [message({ body: '<img src=x onerror=alert(1)>\nmore' })] })] }));
    expect(container.querySelector('img')).toBeNull();
    const summary = screen.getByRole('button', { name: /resolved/ });
    expect(within(summary).getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
  });
});
