import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { LEAVE_FILE, type Route } from '@/lib/route';
import type { RoundRecap } from '@/lib/types';
import { threadPlace } from '@/features/threads/ThreadCard';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Row({ tone = 'ok', label, hint, action }: { tone?: 'ok' | 'warn'; label: string; hint: string; action?: { text: string; onClick: () => void } }) {
  return (
    <li className={cn('flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md px-2 py-1.5 text-sm', tone === 'warn' && 'bg-warning/10')}>
      <span aria-hidden className={cn('size-2 shrink-0 rounded-full', tone === 'warn' ? 'bg-warning' : 'bg-muted-foreground/50')} />
      <span className="font-medium">{label}</span>
      <span className="ml-auto text-xs text-muted-foreground">{hint}</span>
      {action && <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={action.onClick}>{action.text}</Button>}
    </li>
  );
}

/** What a round sends, row by row, and the threads going out with it. Rows that do not apply are not drawn. */
export function RecapSummary({ recap, onGo }: { recap: RoundRecap; onGo: (route: Route) => void }) {
  const { hunks, undecided, files, needsYou, waiting, outgoing } = recap;
  const first = undecided[0];
  return (
    <div className="flex flex-col gap-2">
      <ul aria-label="What this round sends" className="flex flex-col gap-0.5">
        {hunks && <Row label={`${plural(hunks.accepted, 'hunk')} accepted · ${hunks.rejected} rejected`} hint="sent as decided" />}
        {hunks && hunks.pending > 0 && (
          <Row tone="warn" label={`${plural(hunks.pending, 'hunk')} undecided`} hint="sent as “not reviewed yet”"
            action={first && { text: 'Review them', onClick: () => onGo({ ...LEAVE_FILE, file: first.path, side: first.side ?? undefined, lines: first.line ? String(first.line) : undefined }) }} />
        )}
        {files !== null && <Row label={plural(files, 'changed file')} hint="the reviewer is asked to review them" />}
        {needsYou.length > 0 && (
          <Row tone="warn" label={`${plural(needsYou.length, 'thread')} still ${needsYou.length === 1 ? 'needs' : 'need'} you`} hint="the agent can’t act on these until you reply"
            action={{ text: 'Answer first', onClick: () => onGo(threadPlace(needsYou[0])) }} />
        )}
        {waiting > 0 && <Row label={`${plural(waiting, 'thread')} already sent`} hint="still waiting on the agent; not repeated" />}
      </ul>
      <div className="flex flex-col gap-1.5 px-2">
        <p className="text-sm">
          <span className="font-medium">Going out with this round</span>
          <span className="text-muted-foreground"> — {outgoing.length ? `${plural(outgoing.length, 'thread')} with your new activity · will be sent` : 'No thread activity in this round.'}</span>
        </p>
        {outgoing.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {outgoing.map((t) => (
              <Button key={t.id} variant="outline" size="sm" className="h-auto min-w-0 max-w-full py-0.5 font-mono text-xs" onClick={() => onGo(threadPlace(t))}>
                <span className="truncate">{t.id} · {t.where}</span>
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
