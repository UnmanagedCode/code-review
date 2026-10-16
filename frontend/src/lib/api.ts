/** A JSON request to this plugin's own backend. `path` is relative: a `/`-led path would reach cc's API. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  if (path.startsWith('/')) throw new Error(`api('${path}'): root-relative, so it would reach cc, not this plugin`);
  // The backend refuses mutating requests that are not JSON, body-less ones included.
  const get = !init?.method || init.method.toUpperCase() === 'GET';
  const headers = new Headers(init?.headers);
  if (!get && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const res = await fetch(path, get ? init : { ...init, headers });
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}
