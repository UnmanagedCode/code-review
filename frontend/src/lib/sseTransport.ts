import type { FromWorker, ToWorker } from './sseHub';
import { openSource, type SourceHandlers } from './sseSource';

export interface Transport { close: () => void }
export type TransportFactory = (on: SourceHandlers) => Transport;

/**
 * Where events come from: a SharedWorker shared by every tab of the origin (one `api/events` connection per browser, not
 * per tab: the browser allows about six per origin), else a stream in this tab. Chosen once, on the first subscribe, and
 * never released for the page's life. A worker that errors before it relays anything (a CSP or load failure) falls back
 * to the tab's own stream.
 */
export function chooseTransport(make: (url: string) => EventSource): TransportFactory {
  return (on) => {
    let rejoin = () => {};
    let leave = () => {};
    let inner: Transport | null = null;
    // A page restored from the back/forward cache missed every event since it was frozen, whichever transport it uses.
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) { rejoin(); on.reconnect(); } };
    const onHide = () => leave();
    addEventListener('pageshow', onShow);
    addEventListener('pagehide', onHide);
    const inTab = () => openSource('api/events', make, on);
    const done = (t: Transport): Transport => ({
      close() {
        removeEventListener('pageshow', onShow);
        removeEventListener('pagehide', onHide);
        t.close();
      },
    });
    if (typeof SharedWorker !== 'function') return done(inTab());
    let worker: SharedWorker;
    try {
      worker = new SharedWorker(new URL('./sseWorker.ts', import.meta.url), { type: 'module', name: 'code-review-events' });
    } catch (e) {
      console.warn('event stream: SharedWorker unavailable, using a stream in this tab', e);
      return done(inTab());
    }
    const url = new URL('api/events', document.baseURI).href;
    const send = (m: ToWorker) => worker.port.postMessage(m);
    let relayed = false;
    worker.port.onmessage = (e: MessageEvent<FromWorker>) => {
      relayed = true;
      if (e.data.t === 'review') on.review(e.data.data);
      else on.reconnect();
    };
    worker.addEventListener('error', () => {
      if (relayed || inner) return;
      console.warn('event stream: the shared worker failed to start, using a stream in this tab');
      worker.port.close();
      inner = inTab();
    });
    worker.port.start();
    send({ t: 'hello', url });
    // The worker closes its stream when the last tab says bye; a restored page says hello again.
    leave = () => send({ t: 'bye' });
    rejoin = () => send({ t: 'hello', url });
    return done({ close: () => { send({ t: 'bye' }); inner?.close(); } });
  };
}
