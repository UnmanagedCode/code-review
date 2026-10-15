const ALLOWED = new Set(['http:', 'https:', 'mailto:']);

/** `u` as an href when it parses to an http(s) or mailto URL; null otherwise (render it as text). */
export function safeHref(u: string): string | null {
  try {
    const url = new URL(u, location.href);
    return ALLOWED.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
