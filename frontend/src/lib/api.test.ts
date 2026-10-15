import { afterEach, expect, test, vi } from 'vitest';
import { api } from './api';

afterEach(() => vi.unstubAllGlobals());

test('api refuses root-relative paths without making a request', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  await expect(api('/api/x')).rejects.toThrow(/root-relative/);
  expect(fetchMock).not.toHaveBeenCalled();
});

test('api requests a relative path and returns the JSON body', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
  vi.stubGlobal('fetch', fetchMock);
  await expect(api('api/x')).resolves.toEqual({ ok: true });
  expect(fetchMock).toHaveBeenCalledWith('api/x', undefined);
});
