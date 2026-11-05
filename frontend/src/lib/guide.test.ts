import { expect, test } from 'vitest';
import { guideGroup, guideView, hunk, review } from '@/test/fixtures';
import type { GuideHunk } from './types';
import {
  byFile, clearGroups, groupLabel, guideAvailable, guideProgress, guideSteps, hunkPlace, OTHER, stepAt, withGroupVerdict, withHunkVerdicts,
} from './guide';

const gh = (id: string, file: string | null, verdict: GuideHunk['verdict'] = 'pending'): GuideHunk => ({ id, file, verdict });
const guide = () => guideView({
  groups: [
    guideGroup({ id: 'g2', order: 2, title: 'Second', hunks: [gh('h3', 'b.ts')] }),
    guideGroup({ id: 'g1', order: 1, title: 'First', hunks: [gh('h1', 'a.ts'), gh('h2', 'b.ts', 'accepted')], verdict: 'accepted' }),
  ],
  ungrouped: [gh('h4', 'a.ts')],
  retired: [{ id: 'g9', title: 'Old', retiredIn: 1, reason: 'refresh' }],
});

test('steps follow the groups\' order, numbered from 1, with Other changes last', () => {
  // Invariant: the reading order is `order`, not the list order; Other changes closes the walk.
  const steps = guideSteps(guide());
  expect(steps.map((s) => [s.key, s.n])).toEqual([['g1', 1], ['g2', 2], [OTHER, 3]]);
});

test('Other changes exists only when some hunk is in no group (null counts as none)', () => {
  // Invariant: no ungrouped hunks (empty, or unknown while the snapshot is unreadable) means no Other changes step.
  expect(guideSteps(guideView({ ungrouped: [] })).map((s) => s.key)).toEqual(['g1']);
  expect(guideSteps(guideView({ ungrouped: null })).map((s) => s.key)).toEqual(['g1']);
});

test('stepAt: no key is the first step, an unknown key is null', () => {
  // Invariant: an absent step shows the first one; a key naming nothing resolves to no step (the view replaces it out).
  const steps = guideSteps(guide());
  expect(stepAt(steps, undefined)?.key).toBe('g1');
  expect(stepAt(steps, 'g2')?.key).toBe('g2');
  expect(stepAt(steps, OTHER)?.key).toBe(OTHER);
  expect(stepAt(steps, 'g9')).toBeNull();
  expect(stepAt([], undefined)).toBeNull();
});

test('progress counts group steps by verdict, with Other changes in the total only', () => {
  // Invariant: Other changes has no verdict, so it never counts as accepted or rejected.
  expect(guideProgress(guideSteps(guide()))).toEqual({ total: 3, accepted: 1, rejected: 0 });
});

test('byFile buckets hunks per file in first-appearance order and keeps a null file as one bucket', () => {
  // Invariant: files appear in the order the guide first names them, not alphabetically; an unknown file is not dropped.
  expect(byFile([gh('1', 'b.ts'), gh('2', 'a.ts'), gh('3', 'b.ts'), gh('4', null), gh('5', null)]).map((b) => [b.file, b.hunks.map((h) => h.id)]))
    .toEqual([['b.ts', ['1', '3']], ['a.ts', ['2']], [null, ['4', '5']]]);
});

test('hunkPlace: the new-side range, the old side for a pure deletion, and no lines for a file-level hunk', () => {
  // Invariant: "Open in file" lands on the lines the hunk occupies on the side that has them.
  expect(hunkPlace('a.ts', hunk({ newStart: 10, newLines: 3 }))).toEqual({ file: 'a.ts', side: 'new', lines: '10-12', thread: undefined });
  expect(hunkPlace('a.ts', hunk({ oldStart: 5, oldLines: 2, newStart: 4, newLines: 0 }))).toEqual({ file: 'a.ts', side: 'old', lines: '5-6', thread: undefined });
  expect(hunkPlace('img.png', { id: 'f1', kind: 'file', lines: [], verdict: 'pending' })).toEqual({ file: 'img.png', side: undefined, lines: undefined, thread: undefined });
});

test('groupLabel names a current group by step, a retired one as retired, an unknown one by id', () => {
  // Invariant: a thread's location link never shows a bare id when the guide knows the group.
  const g = guide();
  expect(groupLabel(g, 'g2')).toBe('Step 2 · Second');
  expect(groupLabel(g, 'g9')).toBe('Old (retired)');
  expect(groupLabel(g, 'g77')).toBe('Group g77');
});

test('the patch helpers touch only the named group or hunks', () => {
  // Invariant: a group verdict patch leaves its hunks to the server; a hunk patch leaves every other hunk and every group verdict alone.
  const g = guide();
  const a = withGroupVerdict(g, 'g2', 'rejected');
  expect(a.groups.map((x) => [x.id, x.verdict])).toEqual([['g2', 'rejected'], ['g1', 'accepted']]);
  expect(a.groups[0].hunks).toEqual(g.groups[0].hunks);
  const b = clearGroups(g, ['g1']);
  expect(b.groups.map((x) => [x.id, x.verdict])).toEqual([['g2', 'pending'], ['g1', 'pending']]);
  expect(b.groups[1].hunks).toEqual(g.groups[1].hunks);
  const c = withHunkVerdicts(g, { h1: 'rejected', h4: 'accepted' });
  expect(c.groups.flatMap((x) => x.hunks).map((h) => [h.id, h.verdict])).toEqual([['h3', 'pending'], ['h1', 'rejected'], ['h2', 'accepted']]);
  expect(c.ungrouped).toEqual([gh('h4', 'a.ts', 'accepted')]);
  expect(c.groups.map((x) => x.verdict)).toEqual(['pending', 'accepted']);
  expect(withHunkVerdicts(guideView({ ungrouped: null }), { h1: 'accepted' }).ungrouped).toBeNull();
});

test('guideAvailable is false for uncommitted reviews, past views, a commit filter and no guide', () => {
  // Invariant: the Guided tab belongs to the live round of a committed review that has groups or can ask for them.
  const base = { review: review(), guide: guideView(), pastView: false, commit: undefined };
  expect(guideAvailable(base)).toBe(true);
  expect(guideAvailable({ ...base, review: review({ kind: 'uncommitted' }) })).toBe(false);
  expect(guideAvailable({ ...base, pastView: true })).toBe(false);
  expect(guideAvailable({ ...base, commit: 'abc1234' })).toBe(false);
  expect(guideAvailable({ ...base, guide: null })).toBe(false);
  expect(guideAvailable({ ...base, guide: guideView({ groups: [] }) })).toBe(false);
  expect(guideAvailable({ ...base, guide: guideView({ groups: [], guideMe: { offered: true, noGroups: true, droppedGroups: 0, newUngrouped: 0 } }) })).toBe(true);
});
