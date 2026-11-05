import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { expect, test, vi } from 'vitest';
import { refusal, review } from '@/test/fixtures';
import { sampleGuide } from '@/test/guideWorld';
import { ctxValue } from '@/test/renderCtx';
import { stubFetch } from '@/test/stubFetch';
import { noteCleared, useClearedGroups } from './clearedGroups';
import { useGroupActions } from './groups';
import { ReviewProvider } from './reviewContext';

const setup = () => {
  const value = ctxValue();
  const hook = renderHook(() => useGroupActions(), { wrapper: ({ children }: { children: ReactNode }) => <ReviewProvider value={value}>{children}</ReviewProvider> });
  return { value, ...hook };
};
const applied = (value: ReturnType<typeof ctxValue>, i = 0) => (vi.mocked(value.patchGuide).mock.calls[i][0])(sampleGuide());

test('the group flips in the guide before the PUT resolves, and no hunk is patched until it does', async () => {
  // Invariant: optimism stops at the group's own verdict; hunk writes come only from the response.
  let answer!: (v: unknown) => void;
  stubFetch({ 'PUT api/reviews/r-1/groups/g1/verdict': () => new Promise((r) => { answer = r; }) });
  const { value, result } = setup();
  let done!: Promise<void>;
  act(() => { done = result.current.setGroupVerdict('g1', 'rejected', 'pending'); });
  expect(value.patchGuide).toHaveBeenCalledTimes(1);
  expect(applied(value).groups.map((g) => [g.id, g.verdict])).toEqual([['g1', 'rejected'], ['g2', 'pending']]);
  expect(applied(value).groups[0].hunks.every((h) => h.verdict === 'pending')).toBe(true);
  expect(value.diffs.patchVerdicts).not.toHaveBeenCalled();
  answer({ groupId: 'g1', verdict: 'rejected', hunks: [], fileSigs: [], guide: sampleGuide(), review: review() });
  await act(async () => { await done; });
});

test('on success it applies the response guide, patches each file from the response hunks and sigs, then applies the review and reloads', async () => {
  const guide = sampleGuide({}, { verdict: 'accepted' });
  stubFetch({ 'PUT api/reviews/r-1/groups/g1/verdict': {
    groupId: 'g1', verdict: 'accepted', hunks: [{ id: 'h1', verdict: 'accepted' }, { id: 'h3', verdict: 'accepted' }, { id: 'h2', verdict: 'accepted' }],
    fileSigs: [{ path: 'a.ts', sig: 'sa2' }, { path: 'b.ts', sig: 'sb2' }], guide, review: review({ rev: 5 }),
  } });
  const { value, result } = setup();
  await act(async () => { await result.current.setGroupVerdict('g1', 'accepted', 'pending'); });
  expect(vi.mocked(value.patchGuide).mock.calls.at(-1)![0](sampleGuide())).toEqual(guide);
  expect(vi.mocked(value.diffs.patchVerdicts).mock.calls).toEqual([
    ['a.ts', { h1: 'accepted', h2: 'accepted' }], ['b.ts', { h3: 'accepted' }],
  ]);
  expect(vi.mocked(value.diffs.patchSig).mock.calls).toEqual([[{ path: 'a.ts', sig: 'sa2' }], [{ path: 'b.ts', sig: 'sb2' }]]);
  expect(value.applyReview).toHaveBeenCalledWith(review({ rev: 5 }));
  expect(value.reload).toHaveBeenCalled();
});

test('a refusal reverts the group to its previous verdict, toasts, and reloads only when the guide proved stale', async () => {
  const error = vi.spyOn(toast, 'error').mockImplementation(() => '');
  stubFetch({ 'PUT api/reviews/r-1/groups/g1/verdict': refusal('REVIEW_CLOSED') });
  const a = setup();
  await act(async () => { await a.result.current.setGroupVerdict('g1', 'accepted', 'rejected'); });
  expect(error).toHaveBeenCalledWith('The review is closed; reopen it to change it');
  expect(applied(a.value, 1).groups[0].verdict).toBe('rejected');
  expect(a.value.reload).not.toHaveBeenCalled();
  a.unmount();
  stubFetch({ 'PUT api/reviews/r-1/groups/g1/verdict': refusal('GROUP_UNKNOWN', 404) });
  const b = setup();
  await act(async () => { await b.result.current.setGroupVerdict('g1', 'accepted', 'pending'); });
  expect(b.value.reload).toHaveBeenCalled();
});

test('choosing a verdict forgets the group\'s "set back to pending" mark', async () => {
  // Invariant: the mark explains a server-side clear; once you set the group yourself it no longer applies.
  stubFetch({ 'PUT api/reviews/r-1/groups/g1/verdict': refusal('REVIEW_CLOSED') });
  vi.spyOn(toast, 'error').mockImplementation(() => '');
  const value = ctxValue();
  const { result } = renderHook(() => ({ actions: useGroupActions(), cleared: useClearedGroups('r-1') }),
    { wrapper: ({ children }: { children: ReactNode }) => <ReviewProvider value={value}>{children}</ReviewProvider> });
  act(() => noteCleared('r-1', ['g1', 'g2']));
  expect([...result.current.cleared]).toEqual(['g1', 'g2']);
  await act(async () => { await result.current.actions.setGroupVerdict('g1', 'accepted', 'pending'); });
  expect([...result.current.cleared]).toEqual(['g2']);
});
