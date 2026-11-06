import { ArrowLeftIcon, ChevronLeftIcon, ChevronRightIcon, MessageSquarePlusIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { byFile, guideSteps, stepAt, type Step } from '@/lib/guide';
import type { GuideGroup } from '@/lib/types';
import { LEAVE_FILE, navigate, useRoute } from '@/lib/route';
import { useClearedGroups } from '@/state/clearedGroups';
import { useGroupActions } from '@/state/groups';
import { useReviewCtx } from '@/state/reviewContext';
import { Empty } from '@/features/common/States';
import { VerdictToggle } from '@/features/diff/HunkBar';
import { SettledThread } from '@/features/diff/SettledThread';
import { useCollapse } from '@/features/diff/useCollapse';
import { Composer } from '@/features/threads/Composer';
import { Markdown } from '@/features/threads/Markdown';
import { GuideFileSection } from './GuideFileSection';
import { RetiredGroupView } from './RetiredGroupView';

const NO_CITATIONS: never[] = [];

/** The line under the header that explains a group verdict that disagrees with its hunks. */
function useNote(group: GuideGroup | null): string | null {
  const cleared = useClearedGroups(useReviewCtx().id);
  if (!group) return null;
  if (group.verdict === 'pending' && cleared.has(group.id)) return 'Set back to pending: you changed the verdict of one of its hunks.';
  const pending = group.hunks.filter((h) => h.verdict === 'pending').length;
  if (group.verdict === 'accepted' && pending > 0) return `${pending} ${pending === 1 ? 'hunk' : 'hunks'} still pending — Accept group again to accept them.`;
  return null;
}

function StepBody({ step, steps, onBack }: { step: Step; steps: Step[]; onBack?: () => void }) {
  const ctx = useReviewCtx();
  const route = useRoute();
  const actions = useGroupActions();
  const [composing, setComposing] = useState(false);
  const group = step.kind === 'group' ? step.group : null;
  const note = useNote(group);
  const i = steps.findIndex((s) => s.key === step.key);
  const go = (s: Step | undefined) => s && navigate({ ...LEAVE_FILE, step: s.key });
  const closed = ctx.review.status === 'closed';
  const threads = useMemo(() => (group ? (ctx.guide?.threads ?? []).filter((t) => t.anchor.kind === 'group' && t.anchor.groupId === group.id) : []), [ctx.guide, group]);
  const settled = useMemo(() => threads.filter((t) => t.status === 'resolved').map((t) => `t:${t.id}`), [threads]);
  const forced = useMemo(() => new Set<string>(), []);
  const collapse = useCollapse({ settled, forced, pinned: route.thread ? `t:${route.thread}` : null, resetKey: `${ctx.id}:${step.key}`, keepOpen: () => false });
  useEffect(() => { setComposing(false); }, [step.key]);
  // The file headings pin just below this header, whose height varies as it wraps: publish it as a CSS variable.
  const rootRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = rootRef.current;
    const header = headerRef.current;
    if (!root || !header) return;
    const set = () => root.style.setProperty('--step-header-h', `${header.offsetHeight}px`);
    set();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(set);
    ro.observe(header);
    return () => ro.disconnect();
  }, [step.key]);
  const hunks = group ? group.hunks : (step as Extract<Step, { kind: 'other' }>).hunks;
  return (
    <div ref={rootRef} className="flex min-w-0 flex-col">
      <div ref={headerRef} className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b bg-background px-3 py-2">
        {onBack && <Button variant="ghost" size="icon-sm" aria-label="Back to steps" onClick={onBack}><ArrowLeftIcon /></Button>}
        <span className="text-xs text-muted-foreground">Step {step.n} of {steps.length}</span>
        <h2 className="min-w-0 flex-1 basis-40 break-words text-sm font-semibold">{group ? group.title : 'Other changes'}</h2>
        <Button variant="ghost" size="icon-sm" aria-label="Previous step" disabled={i <= 0} onClick={() => go(steps[i - 1])}><ChevronLeftIcon /></Button>
        <Button variant="ghost" size="icon-sm" aria-label="Next step" disabled={i < 0 || i >= steps.length - 1} onClick={() => go(steps[i + 1])}><ChevronRightIcon /></Button>
        {group && (
          <VerdictToggle
            label="Group verdict" value={group.verdict} labels={['Accept group', 'Reject group', 'Pending']} disabled={closed} repeatable
            onChange={(v) => actions.setGroupVerdict(group.id, v, group.verdict)}
          />
        )}
      </div>
      {note && <p className="px-3 pt-2 text-xs text-muted-foreground">{note}</p>}
      <div className="px-3 py-2 text-sm">
        {group ? <Markdown body={group.description} citations={NO_CITATIONS} /> : <p>Hunks that are in no group.</p>}
      </div>
      {group && (threads.length > 0 || !ctx.readOnly) && (
        <section aria-label="Group threads" className="flex flex-col gap-2 border-t px-3 py-2 text-sm">
          {threads.map((t) => (
            <SettledThread key={t.id} thread={t} collapsed={collapse.collapsed.has(`t:${t.id}`)} toggleable={collapse.toggleable(`t:${t.id}`)} onToggle={(o) => collapse.setOpen(`t:${t.id}`, o)} />
          ))}
          {!ctx.readOnly && (composing
            ? <Composer anchor={{ kind: 'group', groupId: group.id }} label="This group" onClose={() => setComposing(false)} />
            : <div><Button size="sm" variant="outline" onClick={() => setComposing(true)}><MessageSquarePlusIcon />Comment on group</Button></div>)}
        </section>
      )}
      {byFile(hunks).map((b) => <GuideFileSection key={b.file ?? '\0unknown'} path={b.file} hunks={b.hunks} stepKey={step.key} />)}
    </div>
  );
}

/**
 * The Guided tab's centre (a phone's whole screen): the routed step, the first when none is routed. A retired group's id
 * shows its retired view; an id that names nothing is replaced out of the URL.
 */
export function GuideStepView({ onBack }: { onBack?: () => void } = {}) {
  const { guide } = useReviewCtx();
  const route = useRoute();
  const steps = useMemo(() => (guide ? guideSteps(guide) : []), [guide]);
  const step = stepAt(steps, route.step);
  const retired = !step && route.step ? guide?.retired.find((r) => r.id === route.step) : undefined;
  const unknown = !!guide && route.step !== undefined && !step && !retired;
  useEffect(() => { if (unknown) navigate({ step: undefined }, { replace: true }); }, [unknown]);
  if (!guide) return <Empty title="No groups for this round" />;
  if (retired) return <RetiredGroupView group={retired} guide={guide} />;
  if (!step) return <Empty title="No groups for this round" />;
  return <StepBody step={step} steps={steps} onBack={onBack} />;
}
