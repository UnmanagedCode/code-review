import type { ReactNode } from 'react';
import { JumpNavProvider } from '@/features/nav/JumpNavProvider';
import { ReviewProvider as Provider, type ReviewCtx } from '@/state/reviewContext';

/** `ReviewProvider` as `ReviewView` mounts it: inside the jump-navigation provider the header and the thread cards read. */
export function ReviewProvider({ value, children }: { value: ReviewCtx; children: ReactNode }) {
  return <Provider value={value}><JumpNavProvider>{children}</JumpNavProvider></Provider>;
}
