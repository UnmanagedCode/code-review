import { CompassIcon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import * as ep from '@/lib/endpoints';
import { useReviewCtx } from '@/state/reviewContext';
import { useSubmission } from '@/state/submit';
import { Spinner } from '@/features/common/States';
import { RecipientPicker } from '@/features/review/RecipientPicker';
import { SubmissionDialog } from '@/features/submit/SubmissionDialog';

/** "Guide me": asks the recipient to group the round (or its new hunks), delivered like a submitted round; its own recipient picker, since the header's is not mounted on the phone's step screen. */
export function GuideMeButton() {
  const ctx = useReviewCtx();
  const { review, guide } = ctx;
  const [picker, setPicker] = useState(false);
  const recipient = ctx.sessions.find((s) => s.sessionId === review.recipient);
  const label = recipient?.label || review.recipient || 'the recipient';
  const sub = useSubmission({ reviewId: ctx.id, compose: () => ep.guideMe(ctx.id), recipientLabel: label, onRecorded: ctx.reload, onNoRecipient: () => setPicker(true) });
  const busy = sub.state.phase === 'composing' || sub.state.phase === 'sending';
  if (!guide?.guideMe.offered || ctx.readOnly) return null;
  const { noGroups, droppedGroups, newUngrouped } = guide.guideMe;
  return (
    <div className="flex flex-col gap-1 border-b px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy} onClick={() => (review.recipient ? sub.start() : setPicker(true))}>
          {busy ? <Spinner /> : <CompassIcon />}Guide me
        </Button>
      </div>
      <ul className="text-xs text-muted-foreground">
        {noGroups && <li>No groups yet — ask {label} to group this round</li>}
        {droppedGroups > 0 && <li>A refresh dropped {droppedGroups} {droppedGroups === 1 ? 'group' : 'groups'} since the last proposal</li>}
        {newUngrouped > 0 && <li>{newUngrouped} new {newUngrouped === 1 ? 'hunk is' : 'hunks are'} in no group</li>}
      </ul>
      <SubmissionDialog sub={sub} title="Guide me" />
      {picker && <RecipientPicker onClose={() => setPicker(false)} />}
    </div>
  );
}
