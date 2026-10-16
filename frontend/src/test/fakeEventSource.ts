import { setEventSourceFactory } from '@/lib/sse';

/** A controllable EventSource: tests call `emit`, `fail` and `reopen`. */
export class FakeEventSource {
  static last: FakeEventSource | null = null;
  closed = false;
  private listeners = new Map<string, Set<(e: Event) => void>>();
  constructor() { FakeEventSource.last = this; }
  addEventListener(type: string, fn: (e: Event) => void) {
    (this.listeners.get(type) ?? this.listeners.set(type, new Set()).get(type)!).add(fn);
  }
  close() { this.closed = true; }
  emit(data: unknown) { this.fire('review', new MessageEvent('review', { data: JSON.stringify(data) })); }
  fail() { this.fire('error', new Event('error')); }
  reopen() { this.fire('open', new Event('open')); }
  private fire(type: string, e: Event) { this.listeners.get(type)?.forEach((f) => f(e)); }
}

export function installFakeEventSource(): void {
  FakeEventSource.last = null;
  setEventSourceFactory(() => new FakeEventSource() as unknown as EventSource);
}
