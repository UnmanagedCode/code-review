import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import * as ep from '@/lib/endpoints';
import { errorText } from '@/lib/refusals';
import { navigate, REVIEW_SCOPED } from '@/lib/route';
import type { Kind } from '@/lib/types';
import { useCheckout, useCheckoutCommits, useSessions } from '@/state/checkout';
import { Empty, Spinner } from '@/features/common/States';
import { BasePicker, OTHER } from './BasePicker';
import { CommitPicker } from './CommitPicker';

const KINDS: { value: Kind; label: string; hint: string }[] = [
  { value: 'range', label: 'Range', hint: 'Everything since a base, up to HEAD' },
  { value: 'commit', label: 'One commit', hint: 'A single commit against its parent' },
  { value: 'uncommitted', label: 'Uncommitted', hint: 'The working tree against HEAD' },
];

export function NewReviewDialog({ project, worktree, onClose }: { project: string; worktree: string | null; onClose: () => void }) {
  const [kind, setKind] = useState<Kind>('range');
  const [choice, setChoice] = useState('');
  const [baseSha, setBaseSha] = useState('');
  const [commitSha, setCommitSha] = useState('');
  const [title, setTitle] = useState('');
  const [recipient, setRecipient] = useState('');
  const [busy, setBusy] = useState(false);
  const checkout = useCheckout(project, worktree);
  const commits = useCheckoutCommits(project, worktree, 50, kind !== 'uncommitted');
  const sessions = useSessions(project, worktree);
  const forkPoints = checkout.data?.forkPoints ?? [];
  // Default to the checkout's own fork point (the nearest one).
  useEffect(() => { if (!choice && forkPoints.length) setChoice(forkPoints[0].ref); }, [forkPoints.length]);

  const base = choice === OTHER ? baseSha : choice;
  const missing = kind === 'range' && !base ? 'Pick a base' : null;

  async function submit() {
    setBusy(true);
    try {
      const { review, reused } = await ep.openReview({
        project, worktree, kind,
        ...(kind === 'range' ? { base } : {}),
        ...(kind === 'commit' && commitSha ? { sha: commitSha } : {}),
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(recipient ? { recipient } : {}),
      });
      if (reused) toast.info('Opened the existing review');
      onClose();
      navigate({ review: review.id, ...REVIEW_SCOPED });
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New review</DialogTitle>
          <DialogDescription>{project} · {worktree ?? 'main checkout'}</DialogDescription>
        </DialogHeader>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">What to review</legend>
          <RadioGroup value={kind} onValueChange={(v) => setKind(v as Kind)} aria-label="What to review">
            {KINDS.map((k) => (
              <div key={k.value} className="flex items-center gap-2">
                <RadioGroupItem value={k.value} id={`kind-${k.value}`} />
                <Label htmlFor={`kind-${k.value}`}>{k.label} <span className="text-muted-foreground">— {k.hint}</span></Label>
              </div>
            ))}
          </RadioGroup>
        </fieldset>
        {kind === 'range' && <BasePicker forkPoints={forkPoints} commits={commits.data?.commits ?? []} choice={choice} onChoice={setChoice} sha={baseSha} onSha={setBaseSha} />}
        {kind === 'commit' && (
          commits.data && commits.data.commits.length === 0 ? <Empty title="No commits" /> : (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="commit-pick">Commit</Label>
              <CommitPicker id="commit-pick" commits={commits.data?.commits ?? []} value={commitSha} onChange={setCommitSha} placeholder="HEAD" />
            </div>
          )
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nr-title">Title (optional)</Label>
          <Input id="nr-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nr-recipient">Recipient session</Label>
          <NativeSelect className="w-full" id="nr-recipient" value={recipient} onChange={(e) => setRecipient(e.target.value)}>
            <option value="">Default</option>
            {sessions.data?.sessions.filter((s) => s.live).map((s) => <option key={s.sessionId} value={s.sessionId}>{s.label || s.sessionId}</option>)}
          </NativeSelect>
        </div>
        <DialogFooter>
          {missing && <span className="self-center text-sm text-muted-foreground">{missing}</span>}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !!missing} onClick={submit}>{busy && <Spinner />}Open review</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
