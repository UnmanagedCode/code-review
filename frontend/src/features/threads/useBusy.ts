import { useState } from 'react';

/** `[busy, run]`: run an async action with `busy` true meanwhile, so its button is disabled. */
export function useBusy(): [boolean, <T>(fn: () => Promise<T>) => Promise<T>] {
  const [busy, setBusy] = useState(false);
  return [busy, async (fn) => {
    setBusy(true);
    try { return await fn(); } finally { setBusy(false); }
  }];
}
