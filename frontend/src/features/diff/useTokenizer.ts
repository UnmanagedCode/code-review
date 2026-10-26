import { useEffect, useState } from 'react';
import type { Tokenize } from '@/lib/highlight';

let loading: Promise<Tokenize> | null = null;

/** Prism's tokenizer once its lazy chunk has loaded (null until then, and while highlighting is off). */
export function useTokenizer(enabled: boolean): Tokenize | null {
  const [tokenize, setTokenize] = useState<Tokenize | null>(null);
  useEffect(() => {
    if (!enabled || tokenize) return;
    let live = true;
    loading ??= import('@/lib/highlight/prism').then((m) => m.tokenize);
    void loading.then((t) => { if (live) setTokenize(() => t); });
    return () => { live = false; };
  }, [enabled, tokenize]);
  return enabled ? tokenize : null;
}
