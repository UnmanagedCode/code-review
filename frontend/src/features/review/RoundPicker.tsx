import { NativeSelect } from '@/components/ui/native-select';
import { navigate } from '@/lib/route';
import { useReviewCtx } from '@/state/reviewContext';

/** Range reviews with more than one round: view a past round, read-only. */
export function RoundPicker() {
  const { review, rounds, round } = useReviewCtx();
  if (review.kind !== 'range' || rounds.length < 2) return null;
  const past = rounds.filter((r) => r.n < review.round).sort((a, b) => b.n - a.n);
  return (
    <div className="px-3 pt-3">
      <label className="sr-only" htmlFor="rp-round">Round</label>
      <NativeSelect className="w-full" size="sm" id="rp-round" value={round ? String(round) : ''}
        onChange={(e) => navigate({ round: e.target.value || undefined, commit: undefined, file: undefined, lines: undefined, side: undefined, thread: undefined })}>
        <option value="">Round {review.round} (current)</option>
        {past.map((r) => <option key={r.n} value={String(r.n)}>Round {r.n} · {r.headSha.slice(0, 7)}</option>)}
      </NativeSelect>
    </div>
  );
}
