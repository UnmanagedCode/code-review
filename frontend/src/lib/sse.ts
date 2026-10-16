/** One shared EventSource on `api/events`. Opened on the first subscriber, closed with the last. */
export interface ReviewEvent { id: string; rev?: number; deleted?: boolean }

let make: () => EventSource = () => new EventSource('api/events');
/** Test seam: replace the EventSource factory. */
export const setEventSourceFactory = (f: () => EventSource): void => { make = f; };

const handlers = new Set<(e: ReviewEvent) => void>();
const reconnects = new Set<() => void>();
let source: EventSource | null = null;
let errored = false;

function open() {
  source = make();
  source.addEventListener('review', (ev) => {
    try {
      const data = JSON.parse((ev as MessageEvent).data) as ReviewEvent;
      handlers.forEach((h) => h(data));
    } catch { /* a malformed event carries nothing to act on */ }
  });
  source.addEventListener('error', () => { errored = true; });
  source.addEventListener('open', () => {
    if (errored) reconnects.forEach((r) => r());
    errored = false;
  });
}
function release() {
  if (handlers.size || reconnects.size) return;
  source?.close();
  source = null;
  errored = false;
}

export function subscribe(fn: (e: ReviewEvent) => void): () => void {
  handlers.add(fn);
  if (!source) open();
  return () => { handlers.delete(fn); release(); };
}
export function onReconnect(fn: () => void): () => void {
  reconnects.add(fn);
  if (!source) open();
  return () => { reconnects.delete(fn); release(); };
}
