import { MessagesSquareIcon } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
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
import { ReviewHeader } from './ReviewHeader';

const XL_QUERY = '(min-width: 80rem)';
const CLEAR = { review: undefined, file: undefined, lines: undefined, side: undefined, thread: undefined, commit: undefined, view: undefined };

const asFileState = (f: { path: string; oldPath: string | null; status: FileState['status']; binary: boolean; tooLarge: boolean; additions: number; deletions: number; hunks: unknown[] }): FileState => ({
  ...f, hunks: f.hunks.length, verdicts: null, threads: { open: 0, resolved: 0, outdated: 0 }, unread: 0,
});

function Banners() {
  const { review } = useReviewCtx();
  const admin = useReviewAdmin();
  return (
    <div className="flex flex-col gap-2 px-3 pt-3 empty:hidden">
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
  const { files } = ctx;
  return (
    <>
      <ReviewHeader />
      <Banners />
      <RefreshControls />
      <CommitFilter />
      {ctx.review.snapshotError ? <ErrorState error={{ code: ctx.review.snapshotError, reason: '' }} />
        : files.length ? <FileTree files={files} selected={route.file} /> : <Empty title="No changes in this range" />}
    </>
  );
}

function ThreadsButton() {
  const { review } = useReviewCtx();
  return (
    <Button variant="outline" size="sm" onClick={() => navigate({ view: 'threads' })}>
      <MessagesSquareIcon />Threads {review.unread > 0 && <Badge>{review.unread}</Badge>}
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
  const fileDiff = useFileDiff({ reviewId: id, path: route.file, version: rv.version, uncommitted: detail?.review.kind === 'uncommitted', commitFiles });
  const treeFiles = useMemo(() => (commitFiles ? commitFiles.map(asFileState) : detail?.files ?? []), [commitFiles, detail?.files]);

  if (rv.deleted) return <Empty title="This review was deleted"><RouteLink to={CLEAR} className="underline">Back to reviews</RouteLink></Empty>;
  if (!detail) return rv.error ? <ErrorState error={rv.error} onRetry={rv.reload} /> : <Loading label="Loading review" rows={8} />;
  if (route.commit && commitDiff.error) return <ErrorState error={commitDiff.error} onRetry={commitDiff.reload} />;
  const readOnly = detail.review.status === 'closed' || !!route.commit;
  return (
    <ReviewProvider value={{
      ...detail, id, commit: route.commit, readOnly, fileDiff, sessions: sessions.data?.sessions ?? [],
      files: treeFiles, reload: rv.reload, applyReview: rv.applyReview,
    }}>
      {chrome}
      <Body />
    </ReviewProvider>
  );
}
