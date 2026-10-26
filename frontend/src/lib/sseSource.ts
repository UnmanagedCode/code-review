export const RETRY_MS = 1_000;
export const RETRY_MAX_MS = 30_000;
/** `EventSource.CLOSED`: the browser has given up on the connection. */
const CLOSED = 2;

export interface SourceHandlers {
  /** The raw `data` of a `review` event. */
  review: (data: string) => void;
  /** The stream opened again after an error: events may have been missed. */
  reconnect: () => void;
}

/**
 * Keeps one EventSource on `url` alive. A transient error is the browser's to retry; the next `open` calls `reconnect`.
 * An error that leaves the source CLOSED (a non-2xx answer, such as a 502 while the plugin backend restarts) is never
 * retried by the browser, so it is reopened here after a doubling delay, capped at RETRY_MAX_MS.
 */
export function openSource(url: string, make: (url: string) => EventSource, on: SourceHandlers): { close: () => void } {
  let source: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let delay = RETRY_MS;
  let errored = false;
  let closed = false;

  function connect() {
    const s = make(url);
    source = s;
    s.addEventListener('review', (ev) => { if (!closed) on.review((ev as MessageEvent).data as string); });
    s.addEventListener('error', () => {
      if (closed) return;
      errored = true;
      if (s.readyState !== CLOSED) return;
      console.warn(`event stream closed by the server; retrying in ${delay} ms`);
      timer = setTimeout(connect, delay);
      delay = Math.min(delay * 2, RETRY_MAX_MS);
    });
    s.addEventListener('open', () => {
      if (closed) return;
      delay = RETRY_MS;
      if (errored) on.reconnect();
      errored = false;
    });
  }
  connect();

  return {
    close() {
      closed = true;
      clearTimeout(timer);
      source?.close();
    },
  };
}
