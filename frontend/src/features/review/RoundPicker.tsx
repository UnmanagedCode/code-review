import { GitCompareArrowsIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { navigate } from '@/lib/route';
import type { Round } from '@/lib/types';
import { useReviewCtx } from '@/state/reviewContext';

const LEAVE_FILE = { file: undefined, lines: undefined, side: undefined, thread: undefined };

/** Range reviews with more than one round: view a past round, or compare two rounds; both read-only. */
export function RoundPicker() {
  const { review, rounds, round, compare } = useReviewCtx();
  if (review.kind !== 'range' || rounds.length < 2) return null;
  const newestFirst = [...rounds].sort((a, b) => b.n - a.n);
  const label = (r: Round) => `Round ${r.n} · ${r.headSha.slice(0, 7)}${r.n === review.round ? ' (current)' : ''}`;
  if (compare) {
    const pick = (from: number, to: number) => navigate({ compare: `${from}..${to}`, ...LEAVE_FILE });
    return (
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1 px-3 pt-3 text-sm">
        <label htmlFor="rp-from">From</label>
        <NativeSelect className="w-full" size="sm" id="rp-from" value={String(compare.from)} onChange={(e) => pick(Number(e.target.value), compare.to)}>
          {newestFirst.filter((r) => r.n < compare.to).map((r) => <option key={r.n} value={String(r.n)}>{label(r)}</option>)}
        </NativeSelect>
        <label htmlFor="rp-to">To</label>
        <NativeSelect className="w-full" size="sm" id="rp-to" value={String(compare.to)} onChange={(e) => pick(compare.from, Number(e.target.value))}>
          {newestFirst.filter((r) => r.n > compare.from).map((r) => <option key={r.n} value={String(r.n)}>{label(r)}</option>)}
        </NativeSelect>
      </div>
    );
  }
  const past = newestFirst.filter((r) => r.n < review.round);
  return (
    <div className="flex items-center gap-2 px-3 pt-3">
      <label className="sr-only" htmlFor="rp-round">Round</label>
      <NativeSelect className="w-full min-w-0" size="sm" id="rp-round" value={round ? String(round) : ''}
        onChange={(e) => navigate({ round: e.target.value || undefined, commit: undefined, ...LEAVE_FILE })}>
        <option value="">Round {review.round} (current)</option>
        {past.map((r) => <option key={r.n} value={String(r.n)}>Round {r.n} · {r.headSha.slice(0, 7)}</option>)}
      </NativeSelect>
      <Button size="sm" variant="outline" className="shrink-0"
        onClick={() => navigate({ compare: `${review.round - 1}..${review.round}`, round: undefined, commit: undefined, ...LEAVE_FILE })}>
        <GitCompareArrowsIcon />Compare rounds
      </Button>
    </div>
  );
}
