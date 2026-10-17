import { useEffect, useRef } from 'react';
import * as ep from '@/lib/endpoints';
import { useFetch } from './useFetch';

/** Read-only view of past round `n` of a range review (idle when `n` is undefined); reloads when `version` moves. */
export function useRoundView(id: string, n: number | undefined, version: number) {
  const fetched = useFetch(n !== undefined ? () => ep.roundView(id, n) : null, [id, n]);
  const lastVersion = useRef(version);
  useEffect(() => {
    if (lastVersion.current !== version) { lastVersion.current = version; fetched.reload(); }
  }, [version]);
  return fetched;
}
