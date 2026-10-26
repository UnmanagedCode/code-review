const own = Object.getOwnPropertyDescriptor(window, 'top');

/**
 * Makes the page look framed by cc: `window.top` answers a top frame at `location` (`'unreadable'` = reading it throws,
 * as a cross-origin top would). Pair with `installBridge()`; `resetTop` (setup.ts) restores the real `top`.
 */
export function installTop(location: { pathname: string; search: string } | 'unreadable' = { pathname: '/', search: '' }): void {
  const top = location === 'unreadable'
    ? { get location(): never { throw new DOMException('Blocked a frame', 'SecurityError'); } }
    : { location };
  Object.defineProperty(window, 'top', { configurable: true, get: () => top });
}

export function resetTop(): void {
  if (own) Object.defineProperty(window, 'top', own);
  else delete (window as { top?: unknown }).top;
}
