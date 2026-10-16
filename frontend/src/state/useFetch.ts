import { useCallback, useEffect, useRef, useState } from 'react';

export interface Fetched<T> {
  data?: T;
  error?: unknown;
  loading: boolean;
  /** Counts successful loads, so dependants can refetch when this one refreshed. */
  version: number;
  reload: () => void;
  mutate: (fn: (data: T) => T) => void;
}

/** Runs `fn` whenever `deps` change or `reload()` is called. A reload keeps the previous data on screen; a dep change drops it. `fn` null = idle. */
export function useFetch<T>(fn: (() => Promise<T>) | null, deps: readonly unknown[]): Fetched<T> {
  const [state, setState] = useState<{ data?: T; error?: unknown; loading: boolean; version: number }>({ loading: !!fn, version: 0 });
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const depsKey = JSON.stringify(deps);
  const lastKey = useRef(depsKey);

  useEffect(() => {
    const run = fnRef.current;
    const changed = lastKey.current !== depsKey;
    lastKey.current = depsKey;
    if (!run) { setState({ loading: false, version: 0 }); return; }
    let live = true;
    setState((s) => (changed ? { loading: true, version: 0 } : { ...s, loading: true }));
    run().then(
      (data) => { if (live) setState((s) => ({ data, loading: false, version: s.version + 1 })); },
      (error) => { if (live) setState((s) => ({ data: changed ? undefined : s.data, error, loading: false, version: s.version })); },
    );
    return () => { live = false; };
  }, [depsKey, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const mutate = useCallback((update: (data: T) => T) => setState((s) => (s.data === undefined ? s : { ...s, data: update(s.data) })), []);
  return { ...state, reload, mutate };
}
