import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, test } from 'vitest';
import { refusal, review } from '@/test/fixtures';
import { ctxValue } from '@/test/renderCtx';
import { stubFetch } from '@/test/stubFetch';
import { ReviewProvider } from './reviewContext';
import { useReviewActions } from './threads';

const actions = (version = 1) => {
  const value = ctxValue({ version });
  return renderHook(() => useReviewActions(), { wrapper: ({ children }: { children: ReactNode }) => <ReviewProvider value={value}>{children}</ReviewProvider> });
};
const posts = (net: ReturnType<typeof stubFetch>) => net.count('POST api/reviews/r-1/read');

// Invariant: any number of cards asking to mark one thread read in one review version cost one request.
test('marking one thread read twice, from two action instances, posts once', async () => {
  const net = stubFetch({ 'POST api/reviews/r-1/read': { review: review() } });
  const [a, b] = [actions().result, actions().result];
  await act(() => Promise.all([a.current.markRead('t-1'), b.current.markRead('t-1')]));
  expect(posts(net)).toBe(1);
});

// Invariant: a later review version (the reload after new messages) may mark the same thread again; Mark all read is never deduped.
test('a new review version, or Mark all read, posts again', async () => {
  const net = stubFetch({ 'POST api/reviews/r-1/read': { review: review() } });
  const [v1, v2] = [actions(1).result, actions(2).result];
  await act(() => v1.current.markRead('t-1'));
  await act(() => v2.current.markRead('t-1'));
  await act(() => v2.current.markRead());
  await act(() => v2.current.markRead());
  expect(posts(net)).toBe(4);
});

// Invariant: a refused mark is forgotten, so it can be asked again in the same version.
test('a refused mark may be retried', async () => {
  const net = stubFetch({ 'POST api/reviews/r-1/read': () => refusal('SYSTEM_UNREACHABLE', 502) });
  const { result } = actions();
  await act(() => result.current.markRead('t-1'));
  await act(() => result.current.markRead('t-1'));
  expect(posts(net)).toBe(2);
});

// Invariant: the version restarts with every visit, so a revisit at an equal version still marks a newly unread thread.
test('after the provider remounts, marking the same thread at the same version posts again', async () => {
  const net = stubFetch({ 'POST api/reviews/r-1/read': { review: review() } });
  const first = actions(1);
  await act(() => first.result.current.markRead('t-1'));
  first.unmount();
  const second = actions(1);
  await act(() => second.result.current.markRead('t-1'));
  expect(posts(net)).toBe(2);
});
