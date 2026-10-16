import { afterEach, expect, test, vi } from 'vitest';
import { api, ApiError } from './api';

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

const sentHeaders = (fetchMock: ReturnType<typeof vi.fn>) => new Headers(fetchMock.mock.calls[0][1]?.headers);

test('api defaults Content-Type to application/json on non-GET requests, body-less ones included', async () => {
  const fetchMock = vi.fn().mockImplementation(async () => new Response('{}'));
  vi.stubGlobal('fetch', fetchMock);
  await api('api/x', { method: 'POST' });
  expect(sentHeaders(fetchMock).get('content-type')).toBe('application/json');
  expect(fetchMock.mock.calls[0][1]?.method).toBe('POST');
});

test('api keeps a Content-Type the caller set, and adds none to GET requests', async () => {
  const fetchMock = vi.fn().mockImplementation(async () => new Response('{}'));
  vi.stubGlobal('fetch', fetchMock);
  await api('api/x', { method: 'PUT', headers: { 'content-type': 'application/json; charset=utf-8' }, body: '{}' });
  expect(sentHeaders(fetchMock).get('content-type')).toBe('application/json; charset=utf-8');
  fetchMock.mockClear();
  await api('api/x', { headers: { 'x-a': '1' } });
  expect(sentHeaders(fetchMock).get('content-type')).toBeNull();
});

test('a {ok:false,code,reason} body with an error status throws ApiError carrying code and reason', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false, code: 'REVIEW_CLOSED', reason: 'closed' }), { status: 409 })));
  await expect(api('api/x')).rejects.toMatchObject({ name: 'ApiError', status: 409, code: 'REVIEW_CLOSED', reason: 'closed' });
});

test('a non-JSON error response throws ApiError with no code', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>bad gateway</html>', { status: 502 })));
  const err = (await api('api/x').catch((e) => e)) as ApiError;
  expect(err).toBeInstanceOf(ApiError);
  expect(err.code).toBeUndefined();
  expect(err.status).toBe(502);
});

test('a network failure throws ApiError with status 0 and no code', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
  await expect(api('api/x')).rejects.toMatchObject({ status: 0, code: undefined });
});
