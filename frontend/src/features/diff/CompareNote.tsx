import { formatLines } from '@/lib/route';
import type { ComparedThread, Thread, UnplacedReason } from '@/lib/types';

const span = (t: Thread) => `L${formatLines(t.anchor.startLine, t.anchor.endLine).replace('-', '–L')}`;
const copyOf = (t: Thread) => t as Partial<ComparedThread>;

export const UNPLACED_TEXT: Record<UnplacedReason, string> = {
  'base-side': 'on the base side',
  'unchanged-file': 'file unchanged between these rounds',
  'no-lines': 'no text lines',
};

/**
 * Where a thread's copy sits in a comparison of rounds `from` and `to`: both positions when one card stands for both
 * copies (`other`), else its own round's lines, and for a round-`from` copy whether it still applies in round `to`.
 */
export function CompareNote({ thread, other, compare }: { thread: Thread; other?: Thread; compare: { from: number; to: number } }) {
  const c = copyOf(thread);
  let text: string;
  if (other) {
    const [a, b] = c.placement === 'from' ? [thread, other] : [other, thread];
    text = `round ${compare.from} ${span(a)} · round ${compare.to} ${span(b)}`;
  } else if (c.placement === 'from') {
    text = `round ${compare.from} ${span(thread)} · ${c.outdatedIn != null ? `outdated in round ${c.outdatedIn}` : `still applies in round ${compare.to}`}`;
  } else text = `round ${compare.to} ${span(thread)}`;
  return <p className="text-xs text-muted-foreground">{text}</p>;
}

/** Why a thread of the comparison has no place in its diff. */
export const UnplacedNote = ({ reason }: { reason: UnplacedReason }) => <p className="text-xs text-muted-foreground">Not in this diff: {UNPLACED_TEXT[reason]}</p>;
