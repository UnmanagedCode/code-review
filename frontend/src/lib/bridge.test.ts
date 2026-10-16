import { renderHook, act } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { installBridge } from '@/test/fakeBridge';
import { getBridge, sendPromptWithin, useBridgeSession } from './bridge';

test('without a bridge nothing is returned and the session hook is undefined', () => {
  expect(getBridge()).toBeUndefined();
  expect(renderHook(() => useBridgeSession()).result.current).toBeUndefined();
});

test('the bridge is read on each call, so one installed later is seen', () => {
  expect(getBridge()).toBeUndefined();
  const b = installBridge();
  expect(getBridge()).toBe(b);
});

test('useBridgeSession follows onSession emissions', () => {
  const b = installBridge();
  const { result } = renderHook(() => useBridgeSession());
  expect(result.current).toBeUndefined();
  act(() => b.emit({ sessionId: 's', project: 'app', worktree: null }));
  expect(result.current).toEqual({ sessionId: 's', project: 'app', worktree: null });
});

test('sendPromptWithin passes the bridge result through', async () => {
  const b = installBridge();
  b.sendPrompt.mockResolvedValue({ ok: false, code: 'SESSION_NOT_READY' });
  await expect(sendPromptWithin(b, 's', 'hi', 1000)).resolves.toEqual({ ok: false, code: 'SESSION_NOT_READY' });
  expect(b.sendPrompt).toHaveBeenCalledWith('s', 'hi');
});

test('sendPromptWithin reports a timeout when cc never answers', async () => {
  vi.useFakeTimers();
  const b = installBridge();
  b.sendPrompt.mockReturnValue(new Promise(() => {}));
  const p = sendPromptWithin(b, 's', 'hi', 25000);
  await vi.advanceTimersByTimeAsync(25000);
  await expect(p).resolves.toEqual({ timedOut: true });
});
