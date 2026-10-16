import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import type { Commit, ForkPoint } from '@/lib/types';
import { CommitPicker } from './CommitPicker';

export const OTHER = '__commit__';

/** The base of a range review: one of the checkout's fork points, or any ancestor commit. `value` is a fork-point ref, OTHER, or ''. */
export function BasePicker({ forkPoints, commits, choice, onChoice, sha, onSha }: {
  forkPoints: ForkPoint[]; commits: Commit[]; choice: string; onChoice: (c: string) => void; sha: string; onSha: (s: string) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">Base</legend>
      <RadioGroup value={choice} onValueChange={onChoice} aria-label="Base">
        {forkPoints.map((f) => (
          <div key={f.ref} className="flex items-center gap-2">
            <RadioGroupItem value={f.ref} id={`base-${f.ref}`} />
            <Label htmlFor={`base-${f.ref}`}>{f.label} <span className="text-muted-foreground">({f.forkSha.slice(0, 7)})</span></Label>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <RadioGroupItem value={OTHER} id="base-other" />
          <Label htmlFor="base-other">Another commit</Label>
        </div>
      </RadioGroup>
      {choice === OTHER && (
        commits.length
          ? <><Label className="sr-only" htmlFor="base-commit">Base commit</Label><CommitPicker id="base-commit" commits={commits} value={sha} onChange={onSha} placeholder="Pick a commit…" /></>
          : <p className="text-sm text-muted-foreground">No commits</p>
      )}
    </fieldset>
  );
}
