import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import type { Severity, ThreadAnchorInput, ThreadKind } from '@/lib/types';
import { clearDraft, useDraft } from '@/state/drafts';
import { useReviewCtx } from '@/state/reviewContext';
import { useReviewActions } from '@/state/threads';
import { Spinner } from '@/features/common/States';
import { useBusy } from './useBusy';

export const MAX_BODY_CHARS = 20_000;
const KINDS: ThreadKind[] = ['comment', 'question', 'suggestion', 'finding'];
const SEVERITIES: Severity[] = ['blocker', 'major', 'minor', 'nit'];

interface Draft { kind: ThreadKind; severity: Severity | ''; body: string }
const EMPTY: Draft = { kind: 'comment', severity: '', body: '' };

/** A new thread's form. The unsent draft lives in the draft store, keyed by review and anchor; Cancel and Post clear it. */
export function Composer({ anchor, label, onClose }: { anchor: ThreadAnchorInput; label: string; onClose: () => void }) {
  const key = `new:${useReviewCtx().id}:${JSON.stringify(anchor)}`;
  const [draft, setDraft] = useDraft(key, EMPTY);
  const { kind, severity, body } = draft;
  const close = () => { clearDraft(key); onClose(); };
  const [busy, run] = useBusy();
  const actions = useReviewActions();
  const tooLong = body.length > MAX_BODY_CHARS;
  const blocked = busy || !body.trim() || tooLong || (kind === 'finding' && !severity);
  return (
    <form
      aria-label={`Comment on ${label}`}
      className="flex flex-col gap-2 rounded-md border bg-card p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (blocked) return;
        if (await run(() => actions.createThread({ anchor, kind, ...(kind === 'finding' ? { severity: severity as Severity } : {}), body }))) close();
      }}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="cmp-kind">Kind</label>
        <NativeSelect size="sm" id="cmp-kind" value={kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as ThreadKind })}>
          {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </NativeSelect>
        {kind === 'finding' && (
          <>
            <label className="sr-only" htmlFor="cmp-sev">Severity</label>
            <NativeSelect size="sm" id="cmp-sev" value={severity} onChange={(e) => setDraft({ ...draft, severity: e.target.value as Severity })}>
              <option value="">Severity…</option>
              {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </NativeSelect>
          </>
        )}
      </div>
      <Textarea aria-label="Message" autoFocus rows={3} value={body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
      <div className="flex items-center justify-end gap-2">
        <span className={tooLong ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>{body.length} / {MAX_BODY_CHARS}</span>
        <Button type="button" variant="ghost" size="sm" onClick={close}>Cancel</Button>
        <Button type="submit" size="sm" disabled={blocked}>{busy && <Spinner />}Post</Button>
      </div>
    </form>
  );
}
