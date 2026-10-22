import { useRef, type ReactNode } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LEAVE_FILE, navigate, useRoute, type Route } from '@/lib/route';
import { useReviewAdmin } from '@/state/admin';
import { useReviewCtx } from '@/state/reviewContext';
import { Empty, ErrorState, Loading } from '@/features/common/States';
import { FileTree } from '@/features/files/FileTree';
import { ThreadPanel } from '@/features/threads/ThreadPanel';
import { HistoryList } from './HistoryList';
import { RefreshControls } from './RefreshControls';
import { ReviewHeader } from './ReviewHeader';
import { ScopeIndicator } from './ScopeIndicator';

type PaneTab = 'files' | 'threads' | 'history';

/** The review's unread count, shown only on the live review (a past view's threads are as they were). */
export function UnreadBadge() {
  const { review, pastView } = useReviewCtx();
  return review.unread > 0 && !pastView ? <Badge>{review.unread}</Badge> : null;
}

function Banners() {
  const { review, round, compare, pastView } = useReviewCtx();
  const admin = useReviewAdmin();
  return (
    <div className="flex flex-col gap-2 px-3 pt-3 empty:hidden">
      {round !== undefined && (
        <Alert variant="info">
          <AlertDescription className="flex-row items-center">
            <span className="flex-1">Viewing round {round} of {review.round} — read-only. Threads sit where they were then; later replies are hidden.</span>
            <Button size="sm" variant="outline" onClick={() => navigate({ round: undefined, ...LEAVE_FILE })}>Back to current round</Button>
          </AlertDescription>
        </Alert>
      )}
      {compare && (
        <Alert variant="info">
          <AlertDescription className="flex-row items-center">
            <span className="flex-1">Comparing round {compare.from} with round {compare.to} — read-only. Left: round {compare.from}’s code and its threads then; right: round {compare.to}’s.</span>
            <Button size="sm" variant="outline" onClick={() => navigate({ compare: undefined, ...LEAVE_FILE })}>Exit comparison</Button>
          </AlertDescription>
        </Alert>
      )}
      {review.status === 'closed' && (
        <Alert><AlertDescription className="flex-row items-center"><span className="flex-1">This review is closed.</span>{!pastView && <Button size="sm" variant="outline" onClick={() => admin.patch({ status: 'open' })}>Reopen</Button>}</AlertDescription></Alert>
      )}
      {review.checkoutGone && <Alert variant="warning"><AlertDescription>The checkout was removed; the review stays readable but can’t refresh.</AlertDescription></Alert>}
    </div>
  );
}

function Files() {
  const ctx = useReviewCtx();
  const route = useRoute();
  const { files, viewLoad } = ctx;
  if (viewLoad?.error) return <ErrorState error={viewLoad.error} onRetry={viewLoad.reload} />;
  if (viewLoad?.loading) return <Loading label={ctx.compare ? 'Loading comparison' : 'Loading round'} rows={4} />;
  if (!viewLoad && ctx.review.snapshotError) return <ErrorState error={{ code: ctx.review.snapshotError, reason: '' }} />;
  return files.length ? <FileTree files={files} selected={route.file} /> : <Empty title="No changes in this range" />;
}

/**
 * The review's side pane: header, banners, refresh and scope on top, then the Files | Threads | History tabs. The tab
 * is the route's `view` (absent = Files), written with replace so Back skips tab switches; every other navigation
 * merges into the route and so keeps it. Inactive panels stay mounted (their state survives) but `hidden`.
 */
export function ReviewPane() {
  const { review } = useReviewCtx();
  const route = useRoute();
  const historyTab = useRef<HTMLButtonElement>(null);
  const hasHistory = review.kind === 'range';
  const tab: PaneTab = route.view === 'threads' ? 'threads' : route.view === 'history' && hasHistory ? 'history' : 'files';
  const choose = (v: string) => navigate({ view: v === 'files' ? undefined : v as Route['view'] }, { replace: true });
  const panel = (value: PaneTab, className: string, children: ReactNode) => (
    <TabsContent value={value} forceMount hidden={tab !== value} className={className}>{children}</TabsContent>
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0">
        <ReviewHeader />
        <Banners />
        <RefreshControls />
        <ScopeIndicator onShowHistory={hasHistory ? () => { choose('history'); historyTab.current?.focus(); } : undefined} />
      </div>
      <Tabs value={tab} onValueChange={choose} className="min-h-0 flex-1 gap-0">
        <TabsList aria-label="Review pane" className="mx-3 mt-2 mb-1 w-auto">
          <TabsTrigger value="files">Files</TabsTrigger>
          <TabsTrigger value="threads">Threads <UnreadBadge /></TabsTrigger>
          {hasHistory && <TabsTrigger ref={historyTab} value="history">History</TabsTrigger>}
        </TabsList>
        {panel('files', 'min-h-0 overflow-y-auto', <Files />)}
        {panel('threads', 'flex min-h-0 flex-col', <ThreadPanel />)}
        {hasHistory && panel('history', 'min-h-0 overflow-y-auto', <HistoryList />)}
      </Tabs>
    </div>
  );
}
