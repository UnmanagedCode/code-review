import type { SourceHandlers } from './sseSource';

/** The slice of a MessagePort the hub uses. */
export interface PortLike {
  postMessage: (message: FromWorker) => void;
  onmessage: ((e: { data: unknown }) => void) | null;
  start?: () => void;
}
/** Tab → worker. `url` is the tab's own absolute `api/events` URL: the worker's base is `assets/`, so it could not resolve it. */
export type ToWorker = { t: 'hello'; url: string } | { t: 'bye' };
/** Worker → tab. `data` is the raw `review` event data; each tab parses it. */
export type FromWorker = { t: 'review'; data: string } | { t: 'reconnect' };

/**
 * The shared worker's side: one stream for every connected tab. The first `hello` opens it (through `openStream`, so
 * reconnect and CLOSED retry behave as in a tab); the last `bye` closes it.
 */
export function createHub(openStream: (url: string, on: SourceHandlers) => { close: () => void }) {
  const ports = new Set<PortLike>();
  let stream: { close: () => void } | null = null;
  const broadcast = (m: FromWorker) => ports.forEach((p) => p.postMessage(m));

  return {
    connect(port: PortLike) {
      port.onmessage = (e) => {
        const msg = e.data as ToWorker;
        if (msg.t === 'hello') {
          ports.add(port);
          stream ??= openStream(msg.url, { review: (data) => broadcast({ t: 'review', data }), reconnect: () => broadcast({ t: 'reconnect' }) });
        } else if (msg.t === 'bye') {
          ports.delete(port);
          if (!ports.size) { stream?.close(); stream = null; }
        }
      };
      port.start?.();
    },
  };
}
