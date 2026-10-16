import { useEffect, useRef } from 'react';
import { onReconnect, subscribe, type ReviewEvent } from '@/lib/sse';

export const DEBOUNCE_MS = 300;

/** Calls `reload` (debounced) for each SSE event `match` accepts, and at once after an SSE reconnect. */
export function useSseReload(reload: () => void, match: (e: ReviewEvent) => boolean, enabled = true): void {
  const matchRef = useRef(match);
  matchRef.current = match;
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = subscribe((e) => {
      if (!matchRef.current(e)) return;
      clearTimeout(timer);
      timer = setTimeout(() => reloadRef.current(), DEBOUNCE_MS);
    });
    const offReconnect = onReconnect(() => reloadRef.current());
    return () => { clearTimeout(timer); off(); offReconnect(); };
  }, [enabled]);
}

export const POLL_MS = 15_000;

/** Calls `reload` on window focus / page becoming visible, and every POLL_MS while visible. */
export function usePolling(reload: () => void, enabled: boolean): void {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useEffect(() => {
    if (!enabled) return;
    const visible = () => document.visibilityState !== 'hidden';
    const kick = () => { if (visible()) reloadRef.current(); };
    const timer = setInterval(kick, POLL_MS);
    window.addEventListener('focus', kick);
    document.addEventListener('visibilitychange', kick);
    return () => { clearInterval(timer); window.removeEventListener('focus', kick); document.removeEventListener('visibilitychange', kick); };
  }, [enabled]);
}
