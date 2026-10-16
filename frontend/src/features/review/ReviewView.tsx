import { MessagesSquareIcon } from 'lucide-react';
import { useEffect, useMemo, type ReactNode } from 'react';
import { RouteLink } from '@/components/RouteLink';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import * as ep from '@/lib/endpoints';
import { navigate, useRoute } from '@/lib/route';
import type { FileState } from '@/lib/types';
import { useMediaQuery, WIDE_QUERY } from '@/lib/useMediaQuery';
import { useSessions } from '@/state/checkout';
import { useFileDiff } from '@/state/fileDiff';
import { useReview } from '@/state/review';
import { useRoundView } from '@/state/round';
import { ReviewProvider, useReviewCtx } from '@/state/reviewContext';
import { useReviewAdmin } from '@/state/admin';
import { useFetch } from '@/state/useFetch';
import { Empty, ErrorState, Loading } from '@/features/common/States';
import { FileDiff } from '@/features/diff/FileDiff';
import { FileTree } from '@/features/files/FileTree';
import { DesktopLayout, PhoneLayout } from '@/features/layout/layouts';
import { ThreadPanel } from '@/features/threads/ThreadPanel';
import { CommitFilter } from './CommitFilter';
import { RefreshControls } from './RefreshControls';
import { RoundPicker } from './RoundPicker';
import { ReviewHeader } from './ReviewHeader';

const XL_QUERY = '(min-width: 80rem)';
const CLEAR = { review: undefined, file: undefined, lines: undefined, side: undefined, thread: undefined, commit: undefined, round: undefined, view: undefined };

const asFileState = (f: { path: string; oldPath: string | null; status: FileState['status']; binary: boolean; tooLarge: boolean; additions: number; deletions: number; hunks: unknown[] }): FileState => ({
  ...f, hunks: f.hunks.length, verdicts: null, threads: { open: 0, resolved: 0, outdated: 0 }, unread: 0,
});

function Banners() {
  const { review, round } = useReviewCtx();
  const admin = useReviewAdmin();
  return (
    <div className="flex flex-col gap-2 px-3 pt-3 empty:hidden">
      {round !== undefined && (
        <Alert variant="info">
          <AlertDescription className="flex-row items-center">
            <span className="flex-1">Viewing round {round} of {review.round} — read-only. Threads sit where they were then; later replies are hidden.</span>
            <Button size="sm" variant="outline" onClick={() => navigate({ round: undefined, file: undefined, lines: undefined, side: undefined, thread: undefined })}>Back to current round</Button>
          </AlertDescription>
        </Alert>
      )}
      {review.status === 'closed' && (
        <Alert><AlertDescription className="flex-row items-center"><span className="flex-1">This review is closed.</span><Button size="sm" variant="outline" onClick={() => admin.patch({ status: 'open' })}>Reopen</Button></AlertDescription></Alert>
      )}
      {review.checkoutGone && <Alert variant="warning"><AlertDescription>The checkout was removed; the review stays readable but can’t refresh.</AlertDescription></Alert>}
    </div>
  );
}

function Sidebar() {
  const ctx = useReviewCtx();
  const route = useRoute();
  const { files, roundLoad } = ctx;
  let tree: ReactNode;
  if (roundLoad?.error) tree = <ErrorState error={roundLoad.error} onRetry={roundLoad.reload} />;
  else if (roundLoad?.loading) tree = <Loading label="Loading round" rows={4} />;
  else if (!roundLoad && ctx.review.snapshotError) tree = <ErrorState error={{ code: ctx.review.snapshotError, reason: '' }} />;
  else tree = files.length ? <FileTree files={files} selected={route.file} /> : <Empty title="No changes in this range" />;
  return (
    <>
      <ReviewHeader />
      <Banners />
      <RefreshControls />
      <RoundPicker />
      {ctx.round === undefined && <CommitFilter />}
      {tree}
    </>
  );
}

function ThreadsButton() {
  const { review, round } = useReviewCtx();
  return (
    <Button variant="outline" size="sm" onClick={() => navigate({ view: 'threads' })}>
      <MessagesSquareIcon />Threads {review.unread > 0 && round === undefined && <Badge>{review.unread}</Badge>}
    </Button>
  );
}

function Body() {
  const route = useRoute();
  const wide = useMediaQuery(WIDE_QUERY);
  const xl = useMediaQuery(XL_QUERY);
  const panelOpen = route.view === 'threads';
  const sheet = !xl && (
    <Sheet open={panelOpen} onOpenChange={(o) => !o && navigate({ view: undefined })}>
      <SheetContent side={wide ? 'right' : 'bottom'} className={wide ? undefined : 'max-h-[85dvh]'}>
        <SheetTitle className="px-4 pt-4">Threads</SheetTitle>
        <SheetDescription className="sr-only">Threads in this review</SheetDescription>
        <ThreadPanel />
      </SheetContent>
    </Sheet>
  );
  if (wide) {
    return (
      <>
        <DesktopLayout left={<Sidebar />} center={<FileDiff extra={!xl ? <ThreadsButton /> : undefined} />} right={xl ? <ThreadPanel /> : undefined} />
        {sheet}
      </>
    );
  }
  return (
    <PhoneLayout>
      {route.file ? <FileDiff onBack={() => navigate({ file: undefined, lines: undefined, side: undefined, thread: undefined })} extra={<ThreadsButton />} /> : <Sidebar />}
      {sheet}
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
  // A round view applies to a past round of a range review, and gives way to the commit filter.
  const asked = route.round && !route.commit && detail?.review.kind === 'range' ? Number(route.round) : undefined;
  const round = asked !== undefined && asked < detail!.review.round ? asked : undefined;
  const roundView = useRoundView(id, round, rv.version);
  // Until the review loads, a round= URL cannot tell a past round from the live one: the open file waits.
  const path = route.round && !route.commit && !detail ? undefined : route.file;
  const fileDiff = useFileDiff({ reviewId: id, path, version: rv.version, uncommitted: detail?.review.kind === 'uncommitted', commitFiles, round });
  const treeFiles = useMemo(
    () => (commitFiles ? commitFiles.map(asFileState) : round !== undefined ? roundView.data?.files ?? [] : detail?.files ?? []),
    [commitFiles, round, roundView.data, detail?.files],
  );
  // The current round (or a later one) is the live view, not a round view.
  const stale = detail && route.round && !route.commit && (detail.review.kind !== 'range' || Number(route.round) >= detail.review.round);
  useEffect(() => { if (stale) navigate({ round: undefined }, { replace: true }); }, [stale]);

  if (rv.deleted) return <Empty title="This review was deleted"><RouteLink to={CLEAR} className="underline">Back to reviews</RouteLink></Empty>;
  if (!detail) return rv.error ? <ErrorState error={rv.error} onRetry={rv.reload} /> : <Loading label="Loading review" rows={8} />;
  if (route.commit && commitDiff.error) return <ErrorState error={commitDiff.error} onRetry={commitDiff.reload} />;
  const readOnly = detail.review.status === 'closed' || !!route.commit || round !== undefined;
  const then = round !== undefined ? roundView.data : undefined;
  return (
    <ReviewProvider value={{
      ...detail, id, commit: route.commit, readOnly, fileDiff, version: rv.version, sessions: sessions.data?.sessions ?? [],
      files: treeFiles, reload: rv.reload, applyReview: rv.applyReview,
      round, roundLoad: round !== undefined ? { loading: roundView.loading && !then, error: roundView.error, reload: roundView.reload } : undefined,
      outdatedThreads: then?.outdatedThreads ?? (round !== undefined ? [] : detail.outdatedThreads),
      unplacedThreads: then?.unplacedThreads ?? [],
      threadCounts: then?.counts ?? (round !== undefined ? { open: 0, resolved: 0, outdated: 0 } : detail.review.counts.threads),
    }}>
      {chrome}
      <Body />
    </ReviewProvider>
  );
}
