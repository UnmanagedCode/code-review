import { MessagesSquareIcon } from 'lucide-react';
import { useEffect, useMemo, type ReactNode } from 'react';
import { RouteLink } from '@/components/RouteLink';
import { Button } from '@/components/ui/button';
import * as ep from '@/lib/endpoints';
import { compareFileState } from '@/lib/compare';
import { LEAVE_FILE, navigate, parseCompare, REVIEW_SCOPED, useRoute } from '@/lib/route';
import type { FileState } from '@/lib/types';
import { useMediaQuery, WIDE_QUERY } from '@/lib/useMediaQuery';
import { useSessions } from '@/state/checkout';
import { useCompare } from '@/state/compare';
import { useFileDiff } from '@/state/fileDiff';
import { useReview } from '@/state/review';
import { useRoundView } from '@/state/round';
import { ReviewProvider } from '@/state/reviewContext';
import { useFetch } from '@/state/useFetch';
import { Empty, ErrorState, Loading } from '@/features/common/States';
import { FileDiff } from '@/features/diff/FileDiff';
import { DesktopLayout, PhoneLayout } from '@/features/layout/layouts';
import { ReviewPane, UnreadBadge } from './ReviewPane';

const CLEAR = { review: undefined, ...REVIEW_SCOPED };
const NO_THREADS = { open: 0, resolved: 0, outdated: 0 };

const asFileState = (f: { path: string; oldPath: string | null; status: FileState['status']; binary: boolean; tooLarge: boolean; additions: number; deletions: number; hunks: unknown[] }): FileState => ({
  ...f, hunks: f.hunks.length, verdicts: null, threads: { open: 0, resolved: 0, outdated: 0 }, unread: 0,
});

/** Phone: the open file's way to the pane's Threads tab (the pane and the diff never share the screen there). */
function PhoneThreadsButton() {
  return (
    <Button variant="outline" size="sm" onClick={() => navigate({ ...LEAVE_FILE, view: 'threads' })}>
      <MessagesSquareIcon />Threads <UnreadBadge />
    </Button>
  );
}

function Body() {
  const route = useRoute();
  const wide = useMediaQuery(WIDE_QUERY);
  if (wide) return <DesktopLayout left={<ReviewPane />} center={<FileDiff />} />;
  return (
    <PhoneLayout>
      {route.file ? <FileDiff onBack={() => navigate(LEAVE_FILE)} extra={<PhoneThreadsButton />} /> : <ReviewPane />}
    </PhoneLayout>
  );
}

/** The open review: loads it, provides the shared context, and picks the layout. */
export function ReviewView({ id, chrome }: { id: string; chrome?: ReactNode }) {
  const route = useRoute();
  const rv = useReview(id);
  const detail = rv.data;
  const sessions = useSessions(detail?.review.project, detail?.review.worktree ?? null);
  const commitDiff = useFetch(route.commit ? () => ep.commitDiff(id, route.commit!) : null, [id, route.commit]);
  const commitFiles = commitDiff.data?.files;
  const range = detail?.review.kind === 'range';
  // A comparison applies to two rounds of a range review, earlier first, up to the current one; it gives way to the
  // commit filter and beats a round view.
  const cmp = route.commit ? null : parseCompare(route.compare);
  const cmpValid = !!cmp && range && cmp.from < cmp.to && cmp.to <= detail!.review.round;
  const compareFrom = cmpValid ? cmp!.from : undefined;
  const compareTo = cmpValid ? cmp!.to : undefined;
  const compare = useMemo(() => (compareFrom !== undefined ? { from: compareFrom, to: compareTo! } : undefined), [compareFrom, compareTo]);
  const compareView = useCompare(id, compare, rv.version);
  // A round view applies to a past round of a range review, and gives way to the commit filter and a comparison.
  const asked = route.round && !route.commit && !compare && range ? Number(route.round) : undefined;
  const round = asked !== undefined && asked < detail!.review.round ? asked : undefined;
  const roundView = useRoundView(id, round, rv.version);
  // Until the review loads, a round= or compare= URL cannot tell a past view from the live one: the open file waits.
  const path = (route.round || route.compare) && !route.commit && !detail ? undefined : route.file;
  const sig = (round !== undefined ? roundView.data?.files : detail?.files)?.find((f) => f.path === path)?.sig;
  const fileDiff = useFileDiff({
    reviewId: id, path, sig, version: rv.version, uncommitted: detail?.review.kind === 'uncommitted', commitFiles, round,
    compare: compare && { ...compare, files: compareView.data?.files, error: compareView.error, reload: compareView.reload },
  });
  const treeFiles = useMemo(
    () => (commitFiles ? commitFiles.map(asFileState)
      : compare ? compareView.data?.files.map(compareFileState) ?? []
        : round !== undefined ? roundView.data?.files ?? [] : detail?.files ?? []),
    [commitFiles, compare, compareView.data, round, roundView.data, detail?.files],
  );
  // The current round (or a later one) is the live view, not a round view; a valid comparison replaces a round view.
  const stale = detail && route.round && !route.commit && (cmpValid || detail.review.kind !== 'range' || Number(route.round) >= detail.review.round);
  useEffect(() => { if (stale) navigate({ round: undefined }, { replace: true }); }, [stale]);
  // A comparison the review cannot have: not a range review, not earlier-first, or past the current round.
  const badCompare = detail && route.compare && !route.commit && !cmpValid;
  useEffect(() => { if (badCompare) navigate({ compare: undefined }, { replace: true }); }, [badCompare]);

  if (rv.deleted) return <Empty title="This review was deleted"><RouteLink to={CLEAR} className="underline">Back to reviews</RouteLink></Empty>;
  if (!detail) return rv.error ? <ErrorState error={rv.error} onRetry={rv.reload} /> : <Loading label="Loading review" rows={8} />;
  if (route.commit && commitDiff.error) return <ErrorState error={commitDiff.error} onRetry={commitDiff.reload} />;
  const pastView = round !== undefined || !!compare;
  const readOnly = detail.review.status === 'closed' || !!route.commit || pastView;
  const past = round !== undefined ? roundView : compare ? compareView : undefined;
  return (
    <ReviewProvider value={{
      ...detail, id, commit: route.commit, readOnly, fileDiff, version: rv.version, sessions: sessions.data?.sessions ?? [],
      files: treeFiles, reload: rv.reload, applyReview: rv.applyReview,
      round, compare: compare && { ...compare, view: compareView.data }, pastView,
      viewLoad: past && { loading: past.loading && !past.data, error: past.error, reload: past.reload },
      outdatedThreads: past ? (round !== undefined && roundView.data?.outdatedThreads) || [] : detail.outdatedThreads,
      threadCounts: past ? past.data?.counts ?? NO_THREADS : detail.review.counts.threads,
    }}>
      {chrome}
      <Body />
    </ReviewProvider>
  );
}
