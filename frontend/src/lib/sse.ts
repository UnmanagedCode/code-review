import { chooseTransport, type Transport, type TransportFactory } from './sseTransport';

/**
 * One shared EventSource on `api/events` per page load. Opened on the first subscriber and never closed by unsubscribing:
 * the list ↔ review swap unmounts every subscriber before the next mounts, and the page, not a component, owns the stream.
 * Where it comes from (a SharedWorker shared by the tabs, else this tab) is `sseTransport.ts`.
 */
export interface ReviewEvent { id: string; rev?: number; deleted?: boolean }

let make: (url: string) => EventSource = (url) => new EventSource(url);
/** Test seam: replace the EventSource factory. */
export const setEventSourceFactory = (f: (url: string) => EventSource): void => { make = f; };

const handlers = new Set<(e: ReviewEvent) => void>();
const reconnects = new Set<() => void>();
let stream: Transport | null = null;
let transport: TransportFactory | null = null;
/** Test seam: replace how the stream is obtained (reset by `resetSse`). */
export const setTransportFactory = (f: TransportFactory): void => { transport = f; };

function ensureOpen() {
  stream ??= (transport ?? chooseTransport((url) => make(url)))({
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
  transport = null;
  handlers.clear();
  reconnects.clear();
}
