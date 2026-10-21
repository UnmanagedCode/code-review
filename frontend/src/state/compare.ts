import { useEffect, useRef } from 'react';
import * as ep from '@/lib/endpoints';
import { useFetch } from './useFetch';

/** Read-only comparison of rounds `cmp.from` and `cmp.to` of a range review (idle without `cmp`); reloads when `version` moves. */
export function useCompare(id: string, cmp: { from: number; to: number } | undefined, version: number) {
  const fetched = useFetch(cmp ? () => ep.compare(id, cmp.from, cmp.to) : null, [id, cmp?.from, cmp?.to]);
  const lastVersion = useRef(version);
  useEffect(() => {
    if (lastVersion.current !== version) { lastVersion.current = version; fetched.reload(); }
  }, [version]);
  return fetched;
}
