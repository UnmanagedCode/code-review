import { act, renderHook } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { BRIDGE_CODES } from '@/lib/refusals';
import { installBridge } from '@/test/fakeBridge';
import { refusal } from '@/test/fixtures';
import { stubFetch } from '@/test/stubFetch';
import { useSubmission, SEND_DEADLINE_MS } from './submit';

const sub = { id: 3, round: 1, recipient: 's-author', text: 'please review', status: 'pending' };
const routes = () => stubFetch({
  'POST api/reviews/r-1/submissions': { submission: sub },
  'POST api/reviews/r-1/submissions/3/result': { submission: { ...sub, status: 'delivered' } },
});
const setup = (extra: Partial<Parameters<typeof useSubmission>[0]> = {}) => {
  const deps = { reviewId: 'r-1', recipientLabel: 'Author', onRecorded: vi.fn(), onNoRecipient: vi.fn(), ...extra };
  return { deps, hook: renderHook(() => useSubmission(deps)) };
};
const results = (net: ReturnType<typeof stubFetch>) => net.calls.filter((c) => c.url.pathname.endsWith('/result')).map((c) => c.body);

test('bridge ok → sendPrompt(recipient, text), then the result is recorded as ok', async () => {
  const bridge = installBridge();
  const net = routes();
  const { hook, deps } = setup();
  await act(() => hook.result.current.start());
  expect(bridge.sendPrompt).toHaveBeenCalledWith('s-author', 'please review');
  expect(results(net)).toEqual([{ ok: true }]);
  expect(hook.result.current.state.phase).toBe('delivered');
  expect(deps.onRecorded).toHaveBeenCalled();
});

test.each(BRIDGE_CODES)('bridge code %s is recorded verbatim and ends in the failed state', async (code) => {
  const bridge = installBridge();
  bridge.sendPrompt.mockResolvedValue({ ok: false, code });
  const net = routes();
  const { hook } = setup();
  await act(() => hook.result.current.start());
  expect(results(net)).toEqual([{ ok: false, code }]);
  expect(hook.result.current.state).toMatchObject({ phase: 'failed', code });
});

test('retry after a failure sends again and posts to the same submission id', async () => {
  const bridge = installBridge();
  bridge.sendPrompt.mockResolvedValueOnce({ ok: false, code: 'SESSION_NOT_READY' });
  const net = routes();
  const { hook } = setup();
  await act(() => hook.result.current.start());
  const state = hook.result.current.state;
  if (state.phase !== 'failed') throw new Error('expected failed');
  await act(() => hook.result.current.resend(state.submission));
  expect(bridge.sendPrompt).toHaveBeenCalledTimes(2);
  expect(net.calls.filter((c) => c.url.pathname === '/api/reviews/r-1/submissions/3/result').map((c) => c.body)).toEqual([{ ok: false, code: 'SESSION_NOT_READY' }, { ok: true }]);
  expect(net.count('POST api/reviews/r-1/submissions')).toBe(1);
});

test('a code outside the bridge list posts nothing and keeps the raw code', async () => {
  const bridge = installBridge();
  bridge.sendPrompt.mockResolvedValue({ ok: false, code: 'BRAND_NEW' });
  const net = routes();
  const { hook } = setup();
  await act(() => hook.result.current.start());
  expect(results(net)).toEqual([]);
  expect(hook.result.current.state).toMatchObject({ phase: 'failed', code: 'BRAND_NEW' });
});

test('a send that outlives the deadline posts nothing and reports timedOut', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const bridge = installBridge();
  bridge.sendPrompt.mockReturnValue(new Promise(() => {}));
  const net = routes();
  const { hook } = setup();
  let started!: Promise<void>;
  await act(async () => { started = hook.result.current.start(); await vi.advanceTimersByTimeAsync(SEND_DEADLINE_MS); await started; });
  expect(results(net)).toEqual([]);
  expect(hook.result.current.state.phase).toBe('timedOut');
});

test('without a bridge the text is handed over; Mark as sent records ok', async () => {
  const net = routes();
  const { hook } = setup();
  await act(() => hook.result.current.start());
  expect(hook.result.current.state).toMatchObject({ phase: 'manual', submission: { text: 'please review' } });
  await act(() => hook.result.current.markSent());
  expect(results(net)).toEqual([{ ok: true }]);
  expect(hook.result.current.state.phase).toBe('delivered');
});

test('closing the manual dialog records nothing', async () => {
  const net = routes();
  const { hook } = setup();
  await act(() => hook.result.current.start());
  act(() => hook.result.current.close());
  expect(results(net)).toEqual([]);
  expect(hook.result.current.state.phase).toBe('idle');
});

test('NO_RECIPIENT asks for a recipient; NOTHING_TO_SUBMIT neither sends nor opens the picker', async () => {
  const bridge = installBridge();
  stubFetch({ 'POST api/reviews/r-1/submissions': refusal('NO_RECIPIENT') });
  const a = setup();
  await act(() => a.hook.result.current.start());
  expect(a.deps.onNoRecipient).toHaveBeenCalled();
  stubFetch({ 'POST api/reviews/r-1/submissions': refusal('NOTHING_TO_SUBMIT') });
  const b = setup();
  await act(() => b.hook.result.current.start());
  expect(b.deps.onNoRecipient).not.toHaveBeenCalled();
  expect(bridge.sendPrompt).not.toHaveBeenCalled();
  expect(b.hook.result.current.state.phase).toBe('idle');
});

test('SUBMISSION_NOT_PENDING on the result post refetches and returns to idle', async () => {
  installBridge();
  stubFetch({
    'POST api/reviews/r-1/submissions': { submission: sub },
    'POST api/reviews/r-1/submissions/3/result': refusal('SUBMISSION_NOT_PENDING'),
  });
  const { hook, deps } = setup();
  await act(() => hook.result.current.start());
  expect(deps.onRecorded).toHaveBeenCalled();
  expect(hook.result.current.state.phase).toBe('idle');
});
