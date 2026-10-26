import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import * as ep from '@/lib/endpoints';
import { useBridgeSession } from '@/lib/bridge';
import type { Prefill } from '@/lib/prefill';
import { errorText } from '@/lib/refusals';
import { navigate, REVIEW_SCOPED } from '@/lib/route';
import { sessionOptions } from '@/lib/sessionOptions';
import type { Commit, Kind } from '@/lib/types';
import { useCheckout, useCheckoutCommits, useSessions } from '@/state/checkout';
import { useFetch } from '@/state/useFetch';
import { Empty, Spinner } from '@/features/common/States';
import { BasePicker, OTHER } from './BasePicker';
import { CommitPicker } from './CommitPicker';

const KINDS: { value: Kind; label: string; hint: string }[] = [
  { value: 'range', label: 'Range', hint: 'Everything since a base, up to HEAD' },
  { value: 'commit', label: 'One commit', hint: 'A single commit against its parent' },
  { value: 'uncommitted', label: 'Uncommitted', hint: 'The working tree against HEAD' },
];

type Resolved = { kind: 'range'; base: Commit; head: Commit } | { kind: 'commit'; commit: Commit };

/** A link's refs resolved by the server, the one ref validator; a refusal rejects with the ref it was about. Idle without a usable prefill. */
function usePrefill(project: string, worktree: string | null, prefill: Prefill | null) {
  const usable = prefill && !('error' in prefill) ? prefill : null;
  return useFetch<Resolved>(usable && (async () => {
    const at = (ref: string) => ep.checkoutCommit(project, worktree, ref).then((r) => r.commit, (error: unknown) => Promise.reject({ ref, error }));
    if (usable.kind === 'commit') return { kind: 'commit', commit: await at(usable.sha) };
    const [base, head] = await Promise.all([at(usable.base), at(usable.head)]);
    return { kind: 'range', base, head };
  }), [project, worktree, usable]);
}

/**
 * `prefill` comes from the URL (`lib/prefill.ts`) and is applied once; the dialog is keyed by it, so a new link remounts it.
 * Nothing is opened from a link: the human still picks the recipient and clicks Open review. An unusable link leaves the defaults and says why.
 */
export function NewReviewDialog({ project, worktree, prefill = null, onClose }: { project: string; worktree: string | null; prefill?: Prefill | null; onClose: () => void }) {
  const [kind, setKind] = useState<Kind>('range');
  const [choice, setChoice] = useState('');
  const [baseSha, setBaseSha] = useState('');
  const [commitSha, setCommitSha] = useState('');
  const [title, setTitle] = useState('');
  const [recipient, setRecipient] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(!!prefill && !('error' in prefill));
  const [linkError, setLinkError] = useState(prefill && 'error' in prefill ? prefill.error : null);
  const [extra, setExtra] = useState<Commit>();
  const checkout = useCheckout(project, worktree);
  const resolved = usePrefill(project, worktree, prefill);
  const commits = useCheckoutCommits(project, worktree, 50, kind !== 'uncommitted');
  const sessions = useSessions(project, worktree);
  const active = useBridgeSession();
  const touched = useRef({ title: false, recipient: false });
  const activeRow = active ? sessions.data?.sessions.find((s) => s.sessionId === active.sessionId) : undefined;
  // Untouched fields follow cc's active session; the user's edit pins a field for the dialog's life.
  useEffect(() => {
    if (!sessions.data) return;
    if (!touched.current.title) setTitle(activeRow?.label || '');
    if (!touched.current.recipient) setRecipient(activeRow?.live ? activeRow.sessionId : '');
  }, [sessions.data, active?.sessionId]);
  const forkPoints = checkout.data?.forkPoints ?? [];
  // Default to the checkout's own fork point (the nearest one).
  useEffect(() => { if (!choice && forkPoints.length) setChoice(forkPoints[0].ref); }, [forkPoints.length]);
  // The prefill, once both it and the checkout are in. Declared after the fork-point default: when both run in one commit, it wins.
  useEffect(() => {
    if (!pending || !prefill || 'error' in prefill) return;
    if (checkout.error) { setPending(false); return; }
    if (resolved.error) {
      const { ref, error } = resolved.error as { ref: string; error: unknown };
      setPending(false);
      setLinkError(`${errorText(error)}: "${ref}"`);
      return;
    }
    const r = resolved.data;
    const co = checkout.data;
    if (!r || !co) return;
    setPending(false);
    if (r.kind === 'commit') { setKind('commit'); setCommitSha(r.commit.sha); setExtra(r.commit); return; }
    const head = co.checkout.headSha;
    if (r.head.sha !== head) {
      setLinkError(`Its range ends at ${r.head.short}, but code-review reviews ranges up to the checkout's HEAD (${head?.slice(0, 7) ?? 'none'})`);
      return;
    }
    // A fork-point ref stays a ref, as when the human picks its radio; anything else is pinned to the resolved sha.
    if (prefill.kind === 'range' && co.forkPoints.some((f) => f.ref === prefill.base)) { setChoice(prefill.base); return; }
    setChoice(OTHER);
    setBaseSha(r.base.sha);
    setExtra(r.base);
  }, [pending, resolved.data, resolved.error, checkout.data, checkout.error]);

  const base = choice === OTHER ? baseSha : choice;
  const missing = !pending && kind === 'range' && !base ? 'Pick a base' : null;

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
        {checkout.error ? (
          <Alert variant="destructive"><AlertTitle>This checkout can't be reviewed</AlertTitle><AlertDescription>{errorText(checkout.error)}</AlertDescription></Alert>
        ) : linkError && (
          <Alert variant="warning"><AlertTitle>This link could not be used</AlertTitle><AlertDescription>{linkError}. Choose what to review below.</AlertDescription></Alert>
        )}
        {pending && !checkout.error && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Reading the link…</p>}
        <fieldset className="flex flex-col gap-2" hidden={pending}>
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
        {!pending && kind === 'range' && <BasePicker forkPoints={forkPoints} commits={commits.data?.commits ?? []} choice={choice} onChoice={setChoice} sha={baseSha} onSha={setBaseSha} extra={extra} />}
        {!pending && kind === 'commit' && (
          commits.data && commits.data.commits.length === 0 && !extra ? <Empty title="No commits" /> : (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="commit-pick">Commit</Label>
              <CommitPicker id="commit-pick" commits={commits.data?.commits ?? []} value={commitSha} onChange={setCommitSha} placeholder="HEAD" extra={extra} />
            </div>
          )
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nr-title">Title (optional)</Label>
          <Input id="nr-title" value={title} onChange={(e) => { touched.current.title = true; setTitle(e.target.value); }} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nr-recipient">Recipient session</Label>
          <NativeSelect className="w-full" id="nr-recipient" value={recipient} onChange={(e) => { touched.current.recipient = true; setRecipient(e.target.value); }}>
            <option value="">Default</option>
            {sessionOptions(sessions.data?.sessions.filter((s) => s.live) ?? []).map(({ session: s, name }) => <option key={s.sessionId} value={s.sessionId}>{name}</option>)}
          </NativeSelect>
        </div>
        <DialogFooter>
          {missing && <span className="self-center text-sm text-muted-foreground">{missing}</span>}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !!missing || pending || !!checkout.error} onClick={submit}>{busy && <Spinner />}Open review</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
