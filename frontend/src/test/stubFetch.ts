import { vi } from 'vitest';
import { json } from './fixtures';

type Responder = Response | unknown | ((url: URL, init?: RequestInit) => Response | unknown | Promise<Response | unknown>);
export interface Call { method: string; url: URL; body: unknown }

/**
 * Stubs global fetch with a route table keyed "METHOD path" (path without the query; a RegExp key matches "METHOD path?query").
 * A non-Response responder is sent as a 200 JSON body. An unmatched request fails the test loudly.
 */
export function stubFetch(routes: Record<string, Responder> | [RegExp, Responder][]) {
  const table = Array.isArray(routes) ? routes : Object.entries(routes).map(([k, v]) => [k, v] as [string | RegExp, Responder]);
  const calls: Call[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://x/');
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });
    const key = `${method} ${url.pathname.replace(/^\//, '')}`;
    const hit = table.find(([k]) => (typeof k === 'string' ? k === key : k.test(`${key}${url.search}`)));
    if (!hit) throw new Error(`unstubbed request: ${key}${url.search}`);
    const r = typeof hit[1] === 'function' ? await (hit[1] as (u: URL, i?: RequestInit) => unknown)(url, init) : hit[1];
    return r instanceof Response ? r : json(r);
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls, count: (key: string) => calls.filter((c) => `${c.method} ${c.url.pathname.replace(/^\//, '')}` === key).length };
}
