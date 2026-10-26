import { createHub, type PortLike } from './sseHub';
import { openSource } from './sseSource';

/** SharedWorker entry: every tab of this origin shares one `api/events` stream. */
const hub = createHub((url, on) => openSource(url, (u) => new EventSource(u), on));
(self as unknown as { onconnect: (e: { ports: PortLike[] }) => void }).onconnect = (e) => hub.connect(e.ports[0]);
