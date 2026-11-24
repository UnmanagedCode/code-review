import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ShortcutId } from '@/lib/shortcuts';
import { useJumpNav } from './jumpNavContext';
import { Tip } from './Tip';

export interface HunkStepper { k: number; n: number; step: (dir: 1 | -1) => void; canStep: (dir: 1 | -1) => boolean }

function Stepper({ noun, label, tinted, prev, next }: {
  noun: string; label: string; tinted?: boolean;
  prev: { id: ShortcutId; disabled: boolean; go: () => void }; next: { id: ShortcutId; disabled: boolean; go: () => void };
}) {
  return (
    <div role="group" aria-label={noun} className={cn('inline-flex items-center gap-0.5 rounded-md border pl-2', tinted && 'border-primary/40 bg-primary/10')}>
      {tinted && <span aria-hidden className="size-1.5 rounded-full bg-primary" />}
      <span aria-live="polite" className="px-1 text-xs whitespace-nowrap">{label}</span>
      <Tip label={`Previous ${noun}`} id={prev.id}><Button variant="ghost" size="icon-sm" className="size-7" aria-label={`Previous ${noun}`} disabled={prev.disabled} onClick={prev.go}><ChevronUpIcon /></Button></Tip>
      <Tip label={`Next ${noun}`} id={next.id}><Button variant="ghost" size="icon-sm" className="size-7" aria-label={`Next ${noun}`} disabled={next.disabled} onClick={next.go}><ChevronDownIcon /></Button></Tip>
    </div>
  );
}

/** The header's position and stepping for the open file's hunks (`hunk`, absent on a file with none) and for the review's open threads. */
export function JumpBar({ hunk }: { hunk?: HunkStepper }) {
  const { threads } = useJumpNav();
  const n = threads.order.length;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {hunk && (
        <Stepper
          noun="hunk" label={`Hunk ${hunk.k} of ${hunk.n}`}
          prev={{ id: 'prev-hunk', disabled: !hunk.canStep(-1), go: () => hunk.step(-1) }} next={{ id: 'next-hunk', disabled: !hunk.canStep(1), go: () => hunk.step(1) }}
        />
      )}
      {threads.available && (n === 0
        ? <span className="text-xs text-muted-foreground">No open threads</span>
        : (
          <Stepper
            noun="thread" tinted={threads.needsYou > 0}
            label={threads.index >= 0 ? `Thread ${threads.index + 1} of ${n} open` : `${n} open ${n === 1 ? 'thread' : 'threads'}`}
            prev={{ id: 'prev-thread', disabled: !threads.canStep(-1), go: () => threads.step(-1) }} next={{ id: 'next-thread', disabled: !threads.canStep(1), go: () => threads.step(1) }}
          />
        ))}
    </div>
  );
}
