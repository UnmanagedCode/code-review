import { createContext, useContext } from 'react';
import type { ThreadDigest } from '@/lib/types';

/** What the jump-navigation provider offers the header, the thread cards and the overlay. */
export interface JumpNav {
  threads: {
    /** False in a past round, a comparison and the commit filter: no thread stepping there. */
    available: boolean;
    /** Every open thread, those that need the reviewer first (`walkOrder`). */
    order: ThreadDigest[];
    /** Where the routed thread sits in `order`; -1 when none is routed or it is not open. */
    index: number;
    /** How many of `order` need the reviewer. */
    needsYou: number;
    step: (dir: 1 | -1) => void;
    canStep: (dir: 1 | -1) => boolean;
  };
  files: { index: number; total: number; step: (dir: 1 | -1) => void; canStep: (dir: 1 | -1) => boolean };
  overlay: { open: boolean; setOpen: (open: boolean) => void };
  /** True once for the thread a step just routed to: its card focuses itself. */
  takeThreadFocus: (id: string) => boolean;
}

export const JumpNavContext = createContext<JumpNav | null>(null);
export function useJumpNav(): JumpNav {
  const v = useContext(JumpNavContext);
  if (!v) throw new Error('useJumpNav outside JumpNavProvider');
  return v;
}
