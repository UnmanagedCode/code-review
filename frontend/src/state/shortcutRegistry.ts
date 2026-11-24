import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { ShortcutId } from '@/lib/shortcuts';

/** Returns false when there was nothing to do: the key then keeps its browser default. */
export type ShortcutHandler = (e: KeyboardEvent) => boolean | void;

const handlers = new Map<ShortcutId, { current: ShortcutHandler }>();
const listeners = new Set<() => void>();
let registered: ReadonlySet<ShortcutId> = new Set();
const publish = () => { registered = new Set(handlers.keys()); listeners.forEach((l) => l()); };

/**
 * Registers `handler` for `id` while the caller is mounted; null registers nothing. The seam features plug into: the
 * provider owns the listener, a feature owns its handler (and, by not registering, hides its shortcut everywhere).
 */
export function useShortcutHandler(id: ShortcutId, handler: ShortcutHandler | null): void {
  const latest = useRef<ShortcutHandler | null>(handler);
  latest.current = handler;
  const on = handler !== null;
  useEffect(() => {
    if (!on) return;
    const entry = { current: (e: KeyboardEvent) => latest.current?.(e) };
    handlers.set(id, entry);
    publish();
    return () => { if (handlers.get(id) === entry) { handlers.delete(id); publish(); } };
  }, [id, on]);
}

/** The ids with a handler now: the overlay lists exactly these. */
export function useRegisteredShortcuts(): ReadonlySet<ShortcutId> {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => registered);
}

/** Runs `id`'s handler; true when it acted. `preventDefault` only then. */
export function dispatchShortcut(id: ShortcutId, e: KeyboardEvent): boolean {
  const h = handlers.get(id);
  if (!h || h.current(e) === false) return false;
  e.preventDefault();
  return true;
}
