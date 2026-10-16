import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { NativeSelect } from '@/components/ui/native-select';
import { useReviewAdmin } from '@/state/admin';
import { useReviewCtx } from '@/state/reviewContext';

export function RecipientPicker({ onClose }: { onClose: () => void }) {
  const { review, sessions } = useReviewCtx();
  const admin = useReviewAdmin();
  const [value, setValue] = useState(review.recipient ?? '');
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Recipient</DialogTitle>
          <DialogDescription>The session that receives each submitted round.</DialogDescription>
        </DialogHeader>
        <label className="sr-only" htmlFor="rp-session">Session</label>
        <NativeSelect className="w-full" id="rp-session" value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="">No recipient</option>
          {sessions.filter((s) => s.live || s.sessionId === review.recipient).map((s) => <option key={s.sessionId} value={s.sessionId}>{s.title || s.sessionId}{s.attached ? ' (attached)' : ''}</option>)}
        </NativeSelect>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={async () => { await admin.patch({ recipient: value || null }); onClose(); }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
