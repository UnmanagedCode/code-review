import { expect, test } from 'vitest';
import { fileState, groupAnchor, guideGroup, guideView, linesAnchor } from '@/test/fixtures';
import type { Anchor, ThreadState } from './types';
import { byPlace, placeLabel, stateGroup } from './threadState';

const at = (anchor: Anchor, id: string) => ({ id, anchor });

// Invariant: threads sort by file tree order (directories first), old side before new, start line; a file thread before line
// threads of its file; group threads after every file thread; review threads last.
test('byPlace orders by tree, side, line, then group and review threads', () => {
  const files = [fileState({ path: 'a.ts' }), fileState({ path: 'dir/b.ts' })];
  const threads = [
    at({ kind: 'review', round: 1 }, 'review'),
    at(groupAnchor(), 'group'),
    at(linesAnchor({ file: 'a.ts', side: 'new', startLine: 2 }), 'a-new-2'),
    at(linesAnchor({ file: 'dir/b.ts', side: 'new', startLine: 1 }), 'b-new-1'),
    at(linesAnchor({ file: 'a.ts', side: 'old', startLine: 9 }), 'a-old-9'),
    at({ kind: 'file', file: 'a.ts', round: 1 }, 'a-file'),
    at(linesAnchor({ file: 'a.ts', side: 'new', startLine: 1 }), 'a-new-1'),
  ];
  expect(byPlace(threads, files).map((t) => t.id)).toEqual(['b-new-1', 'a-file', 'a-old-9', 'a-new-1', 'a-new-2', 'group', 'review']);
});

// Invariant: every state belongs to exactly one filter group, and no state to none.
test('stateGroup maps each state to its group and null to null', () => {
  const groups: Record<ThreadState, string> = { 'awaiting-human': 'needs-you', 'verify-resolution': 'needs-you', unsent: 'unsent', 'awaiting-agent': 'waiting' };
  for (const [state, group] of Object.entries(groups)) expect(stateGroup(state as ThreadState), state).toBe(group);
  expect(stateGroup(null)).toBeNull();
});

test('placeLabel names a line range, a whole file, the review and a group', () => {
  const guide = guideView({ groups: [guideGroup({ id: 'g1', title: 'Rename' })] });
  expect(placeLabel(linesAnchor({ file: 'a.ts', startLine: 3, endLine: 5 }), null)).toBe('a.ts#L3–L5');
  expect(placeLabel({ kind: 'file', file: 'a.ts', round: 1 }, null)).toBe('a.ts (whole file)');
  expect(placeLabel({ kind: 'review', round: 1 }, null)).toBe('Review');
  expect(placeLabel(groupAnchor({ groupId: 'g1' }), guide)).toBe('Group: Rename');
});

// Invariant: group threads sit in their group's step order, not thread-number order; a group the guide no longer lists comes last.
test('byPlace ranks group threads by their group\'s step order', () => {
  const guide = guideView({ groups: [guideGroup({ id: 'g1', order: 1 }), guideGroup({ id: 'g2', order: 2 })] });
  const threads = [
    at(groupAnchor({ groupId: 'g2' }), 't-1'),
    at(groupAnchor({ groupId: 'gone' }), 't-2'),
    at(groupAnchor({ groupId: 'g1' }), 't-3'),
    at(groupAnchor({ groupId: 'g2' }), 't-4'),
  ];
  expect(byPlace(threads, [], guide).map((t) => t.id)).toEqual(['t-3', 't-1', 't-4', 't-2']);
});
