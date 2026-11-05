import { Badge } from '@/components/ui/badge';
import { guideProgress, guideSteps, stepAt, type Step } from '@/lib/guide';
import { LEAVE_FILE, navigate, useRoute } from '@/lib/route';
import type { Verdict } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useReviewCtx } from '@/state/reviewContext';
import { Empty } from '@/features/common/States';
import { GuideMeButton } from './GuideMeButton';

const VERDICT_VARIANT = { accepted: 'success', rejected: 'destructive', pending: 'info' } as const satisfies Record<Verdict, string>;

/** The step's verdict badge; "Other changes" has no verdict of its own, so it counts its decided hunks. */
function StepBadge({ step }: { step: Step }) {
  if (step.kind === 'group') return <Badge variant={VERDICT_VARIANT[step.group.verdict]}>{step.group.verdict}</Badge>;
  const decided = step.hunks.filter((h) => h.verdict !== 'pending').length;
  return <Badge variant="secondary">{decided}/{step.hunks.length} decided</Badge>;
}

/** The Guided tab: Guide me, progress, the ordered steps and the retired groups. A step click pushes history, so Back returns to the previous step. */
export function GuidePanel() {
  const { guide } = useReviewCtx();
  const route = useRoute();
  if (!guide) return null;
  const steps = guideSteps(guide);
  const current = stepAt(steps, route.step);
  const { total, accepted, rejected } = guideProgress(steps);
  const open = (step: string) => navigate({ ...LEAVE_FILE, step });
  return (
    <div className="flex flex-col">
      <GuideMeButton />
      {steps.length === 0 ? <Empty title="No groups for this round" /> : (
        <>
          <p className="px-3 pt-3 text-xs text-muted-foreground">
            {current ? `Step ${current.n} of ${total}` : `${total} ${total === 1 ? 'step' : 'steps'}`} · {accepted} accepted · {rejected} rejected
          </p>
          <nav aria-label="Steps" className="p-2">
            <ol className="flex flex-col gap-1">
              {steps.map((step) => (
                <li key={step.key}>
                  <button
                    type="button"
                    aria-current={current?.key === step.key ? 'step' : undefined}
                    onClick={() => open(step.key)}
                    className={cn('flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent', current?.key === step.key && 'bg-accent')}
                  >
                    <span className="w-5 shrink-0 text-xs text-muted-foreground">{step.n}</span>
                    <span className="min-w-0 flex-1 break-words">{step.kind === 'group' ? step.group.title : 'Other changes'}</span>
                    {step.kind === 'group' && step.group.unread > 0 && <Badge>{step.group.unread} unread</Badge>}
                    <StepBadge step={step} />
                  </button>
                </li>
              ))}
            </ol>
          </nav>
        </>
      )}
      {guide.retired.length > 0 && (
        <section aria-label="Retired groups" className="border-t p-2">
          <h3 className="px-2 pb-1 text-xs font-medium text-muted-foreground">Retired groups</h3>
          <ul className="flex flex-col gap-1">
            {guide.retired.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => open(r.id)} className="flex w-full min-w-0 flex-col items-start rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent">
                  <span className="break-words">{r.title}</span>
                  <span className="text-xs text-muted-foreground">round {r.retiredIn} · {r.reason === 'refresh' ? 'refresh' : 're-proposal'}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
