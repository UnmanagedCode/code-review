import { expect, test } from 'vitest';
import { fileState, review } from '@/test/fixtures';
import { firstUndecided, fileProgress, reviewProgress } from './progress';

const counts = (hunks: unknown) => ({ ...review().counts, hunks } as ReturnType<typeof review>['counts']);

// Invariant: decided = accepted + rejected, total = every hunk of the round, undecided = pending.
test('decided counts accepted and rejected hunks out of all of them', () => {
  expect(reviewProgress(review({ counts: counts({ pending: 3, accepted: 2, rejected: 1 }) }))).toEqual({ decided: 3, undecided: 3, total: 6 });
});

// Invariant: a review without verdicts (uncommitted) or without a readable snapshot has no hunk progress.
test('uncommitted reviews and unreadable snapshots have no progress', () => {
  expect(reviewProgress(review({ kind: 'uncommitted', counts: counts({ total: 4 }) }))).toBeNull();
  expect(reviewProgress(review({ snapshotError: 'CHECKOUT_GONE', counts: counts({ pending: 1, accepted: 0, rejected: 0 }) }))).toBeNull();
  expect(reviewProgress(review({ counts: counts(null) }))).toBeNull();
});

test('a file\'s progress is its decided hunks out of its hunks', () => {
  expect(fileProgress(fileState({ hunks: 3, verdicts: { pending: 1, accepted: 1, rejected: 1 } }))).toEqual({ decided: 2, total: 3 });
  expect(fileProgress(fileState({ verdicts: null }))).toBeNull();
});

// Invariant: "next undecided" follows the order the tree shows (directories first), not the diff's order.
test('firstUndecided is the first file in tree order with a pending hunk', () => {
  const done = { pending: 0, accepted: 1, rejected: 0 };
  const open = { pending: 1, accepted: 0, rejected: 0 };
  const files = [
    fileState({ path: 'a.ts', verdicts: open }),
    fileState({ path: 'z/deep.ts', verdicts: open }),
    fileState({ path: 'b.ts', verdicts: done }),
  ];
  expect(firstUndecided(files)?.path).toBe('z/deep.ts');
  expect(firstUndecided([fileState({ verdicts: done })])).toBeUndefined();
});
