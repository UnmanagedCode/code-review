import { openSource } from './sseSource';

/**
 * One shared EventSource on `api/events` per page load. Opened on the first subscriber and never closed by unsubscribing:
 * the list ↔ review swap unmounts every subscriber before the next mounts, and the page, not a component, owns the stream.
 */
export interface ReviewEvent { id: string; rev?: number; deleted?: boolean }

let make: (url: string) => EventSource = (url) => new EventSource(url);
/** Test seam: replace the EventSource factory. */
export const setEventSourceFactory = (f: (url: string) => EventSource): void => { make = f; };

const handlers = new Set<(e: ReviewEvent) => void>();
const reconnects = new Set<() => void>();
let stream: { close: () => void } | null = null;

function ensureOpen() {
  stream ??= openSource('api/events', make, {
    review(data) {
      try {
        const e = JSON.parse(data) as ReviewEvent;
        handlers.forEach((h) => h(e));
      } catch { /* a malformed event carries nothing to act on */ }
    },
    reconnect: () => reconnects.forEach((r) => r()),
  });
}

export function subscribe(fn: (e: ReviewEvent) => void): () => void {
  handlers.add(fn);
  ensureOpen();
  return () => { handlers.delete(fn); };
}
export function onReconnect(fn: () => void): () => void {
  reconnects.add(fn);
  ensureOpen();
  return () => { reconnects.delete(fn); };
}

/** Test isolation: close the stream and forget every handler. */
export function resetSse(): void {
  stream?.close();
  stream = null;
  handlers.clear();
  reconnects.clear();
}
