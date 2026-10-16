import { safeHref } from './safeHref';
import type { Citation } from './types';

export type Segment =
  | { t: 'text'; text: string }
  | { t: 'cite'; text: string; path: string; start: number; end: number }
  | { t: 'url'; text: string; href: string };

// Same rule as `unsafe()` in src/citations.js.
const unsafePath = (p: string): boolean => p.startsWith('/') || p.split('/').includes('..');
const URL_RE = /https?:\/\/[^\s<>"]+/g;
const TRAILING = /[.,;:!?)\]'}]+$/;

function withUrls(text: string): Segment[] {
  const out: Segment[] = [];
  let at = 0;
  for (const m of text.matchAll(URL_RE)) {
    const raw = m[0].replace(TRAILING, '');
    const href = safeHref(raw);
    if (!href) continue;
    if (m.index > at) out.push({ t: 'text', text: text.slice(at, m.index) });
    out.push({ t: 'url', text: raw, href });
    at = m.index + raw.length;
  }
  if (at < text.length) out.push({ t: 'text', text: text.slice(at) });
  return out;
}

/** Splits a message body into text, citation and URL segments. Citations come from the server's parsed list, scanned in order. */
export function segment(body: string, citations: Citation[]): Segment[] {
  const out: Segment[] = [];
  let at = 0;
  for (const c of citations) {
    const i = body.indexOf(c.raw, at);
    if (i < 0 || unsafePath(c.path)) continue;
    if (i > at) out.push(...withUrls(body.slice(at, i)));
    out.push({ t: 'cite', text: c.raw, path: c.path, start: c.startLine, end: c.endLine });
    at = i + c.raw.length;
  }
  if (at < body.length) out.push(...withUrls(body.slice(at)));
  return out;
}
