import { useEffect, useRef } from 'react';

export const POLL_MS = 15_000;
/** No focus or visibility kick within this long of the last kick or load. */
export const REFOCUS_MIN_MS = 5_000;

/**
 * Keeps an uncommitted review current: `reload` on window focus or the page showing (one request for both: they share a
 * gate of REFOCUS_MIN_MS since the last kick or load) and POLL_MS after the last load while visible. The timer is cleared
 * while hidden. `loadedAt` is the resource's last load, so a load caused by an event pushes the next poll back.
 */
export function usePolling(reload: () => void, enabled: boolean, loadedAt: number): void {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const lastKick = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const visible = () => document.visibilityState !== 'hidden';
    const since = () => Date.now() - Math.max(loadedAt, lastKick.current);
    const arm = () => {
      clearTimeout(timer);
      if (visible()) timer = setTimeout(kick, Math.max(0, POLL_MS - since()));
    };
    function kick() {
      lastKick.current = Date.now();
      reloadRef.current();
      arm();
    }
    const wake = () => {
      if (!visible()) { clearTimeout(timer); return; }
      if (since() >= REFOCUS_MIN_MS) kick(); else arm();
    };
    arm();
    window.addEventListener('focus', wake);
    document.addEventListener('visibilitychange', wake);
    return () => { clearTimeout(timer); window.removeEventListener('focus', wake); document.removeEventListener('visibilitychange', wake); };
  }, [enabled, loadedAt]);
}
