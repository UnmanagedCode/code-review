import { Badge } from '@/components/ui/badge';
import { INFO_TEXT, PRIMARY_TEXT, SUCCESS_TEXT } from '@/components/tone';
import { STATE_LABEL } from '@/lib/threadState';
import type { ThreadState } from '@/lib/types';

const STYLE: Record<ThreadState, { variant: 'outline' | 'secondary'; className?: string }> = {
  'awaiting-human': { variant: 'outline', className: `border-transparent bg-primary/10 ${PRIMARY_TEXT}` },
  'verify-resolution': { variant: 'outline', className: `border-transparent bg-success/15 ${SUCCESS_TEXT}` },
  unsent: { variant: 'outline', className: `border-transparent bg-info/15 ${INFO_TEXT}` },
  'awaiting-agent': { variant: 'secondary' },
};

/** Whose move a thread waits on, in words ("Will be sent" until a round holding it is delivered). */
export function ThreadStateChip({ state }: { state: ThreadState }) {
  const { variant, className } = STYLE[state];
  return <Badge variant={variant} className={className}>{STATE_LABEL[state]}</Badge>;
}
