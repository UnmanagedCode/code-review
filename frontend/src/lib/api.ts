/** A refusal or transport failure from this plugin's backend. `code` is the backend's refusal code, absent for a non-JSON failure. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    readonly reason: string,
  ) {
    super(code ? `${code}: ${reason}` : reason);
    this.name = 'ApiError';
  }
}

/** A JSON request to this plugin's own backend. `path` is relative: a `/`-led path would reach cc's API. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  if (path.startsWith('/')) throw new Error(`api('${path}'): root-relative, so it would reach cc, not this plugin`);
  // The backend refuses mutating requests that are not JSON, body-less ones included.
  const get = !init?.method || init.method.toUpperCase() === 'GET';
  const headers = new Headers(init?.headers);
  if (!get && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  let res: Response;
  try {
    res = await fetch(path, get ? init : { ...init, headers });
  } catch (e) {
    throw new ApiError(0, undefined, e instanceof Error ? e.message : String(e));
  }
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    if (res.ok) throw new ApiError(res.status, undefined, `${init?.method ?? 'GET'} ${path}: response is not JSON`);
  }
  const refusal = body as { ok?: boolean; code?: string; reason?: string } | undefined;
  if (!res.ok || refusal?.ok === false) {
    const code = typeof refusal?.code === 'string' ? refusal.code : undefined;
    throw new ApiError(res.status, code, refusal?.reason ?? `${init?.method ?? 'GET'} ${path}: ${res.status} ${text.slice(0, 200)}`);
  }
  return body as T;
}
