import { Badge } from '@/components/ui/badge';
import { STATE_LABEL } from '@/lib/threadState';
import type { ThreadState } from '@/lib/types';

const VARIANT = { 'awaiting-human': 'default', 'verify-resolution': 'success', unsent: 'info', 'awaiting-agent': 'secondary' } as const;

/** Whose move a thread waits on, in words ("Will be sent" until a round holding it is delivered). */
export function ThreadStateChip({ state }: { state: ThreadState }) {
  return <Badge variant={VARIANT[state]}>{STATE_LABEL[state]}</Badge>;
}
