import { MessageSquarePlusIcon } from 'lucide-react';
import { useEffect, useState, type FocusEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { dedupeCopies, type ShownThread } from '@/lib/compare';
import { navigate, useRoute } from '@/lib/route';
import type { Thread, UnplacedThread } from '@/lib/types';
import { useDropped } from '@/state/dropped';
import { useReviewCtx } from '@/state/reviewContext';
import { useThreadIndex } from '@/state/threadIndex';
import { Empty, ErrorState, Loading } from '@/features/common/States';
import { CompareNote, UnplacedNote } from '@/features/diff/CompareNote';
import { Composer } from './Composer';
import { ThreadCard, threadPlace } from './ThreadCard';

// More filter tabs than a narrow pane fits scroll sideways instead of overflowing it; a tab that takes focus (arrow keys)
// is scrolled into view, which Safari does not do by itself.
const FILTER_TABS = 'm-3 w-auto justify-start overflow-x-auto';
const showFocusedTab = (e: FocusEvent<HTMLElement>) => (e.target as HTMLElement).scrollIntoView?.({ inline: 'nearest', block: 'nearest' });

type Owner = 'all' | 'user' | 'agents';
const ownedBy = (t: Thread, owner: Owner) => owner === 'all' || (t.openedBy.kind === 'human') === (owner === 'user');

function OwnerSelect({ value, onChange }: { value: Owner; onChange: (owner: Owner) => void }) {
  return (
    <>
      <label className="sr-only" htmlFor="tp-owner">Owner</label>
      <NativeSelect size="sm" id="tp-owner" value={value} onChange={(e) => onChange(e.target.value as Owner)}>
        <option value="all">All owners</option><option value="user">User</option><option value="agents">Agents</option>
      </NativeSelect>
    </>
  );
}

const list = (threads: Thread[], opts: { dropped?: boolean; showLocation?: boolean } = {}) => (
  <div className="flex flex-col gap-3 p-3">{threads.map((t) => <ThreadCard key={t.id} thread={t} {...opts} />)}</div>
);

/** Comparison cards, one per thread, each noting where its copies sit (or why it has no place); a review thread sits on no file. */
const compareList = (shown: ShownThread[], compare: { from: number; to: number }, showLocation: boolean) => (
  <div className="flex flex-col gap-3 p-3">
    {shown.map(({ thread: t, other }) => {
      const reason = (t as Partial<UnplacedThread>).reason;
      const note = reason ? <UnplacedNote reason={reason} /> : t.anchor.kind !== 'review' && <CompareNote thread={t} other={other} compare={compare} />;
      return <ThreadCard key={t.id} thread={t} note={note} showLocation={showLocation && !reason} unplaced={!!reason} />;
    })}
  </div>
);

/**
 * When the route names one of the review threads, the Review tab is the one that shows it; otherwise the user's choice.
 * Returns the tab state.
 */
function useThreadTab(reviewThreads: Thread[]) {
  const route = useRoute();
  const [tab, setTab] = useState('file');
  const routedHere = !!route.thread && reviewThreads.some((t) => t.id === route.thread);
  useEffect(() => { if (routedHere) setTab('review'); }, [routedHere, route.thread]);
  return [tab, setTab] as const;
}

/** The thread panel of a comparison: this file's threads, every thread once, the threads its diff has no place for, and the review's own threads. */
function CompareThreadPanel({ compare }: { compare: NonNullable<ReturnType<typeof useReviewCtx>['compare']> }) {
  const ctx = useReviewCtx();
  const [tab, setTab] = useThreadTab(ctx.reviewThreads);
  const [status, setStatus] = useState<'open' | 'resolved' | 'all'>('open');
  const [owner, setOwner] = useState<Owner>('all');
  const view = compare.view;
  const unplaced = view?.unplaced ?? [];
  const fileThreads = dedupeCopies(ctx.fileDiff.file?.threads ?? []);
  // Every compared thread once; one outdated by round B is listed too, as its round-A copy.
  const every = dedupeCopies([...(view?.files.flatMap((f) => f.threads) ?? []), ...unplaced, ...ctx.reviewThreads])
    .sort((a, b) => a.thread.id.localeCompare(b.thread.id, undefined, { numeric: true }));
  const all = every.filter((s) => (status === 'all' || s.thread.status === status) && ownedBy(s.thread, owner));
  // Until the comparison has loaded (or when it failed) no tab can list anything, nor claim that nothing is there.
  // A loaded view wins over an error: a failed reload keeps the previous data.
  const load = ctx.viewLoad;
  const gate = view ? null : load?.error ? <ErrorState error={load.error} onRetry={load.reload} /> : <Loading label="Loading threads" rows={3} />;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 gap-0">
        <TabsList aria-label="Thread filter" className={FILTER_TABS} onFocus={showFocusedTab}>
          <TabsTrigger value="file">This file</TabsTrigger>
          <TabsTrigger value="all">All <Badge variant="secondary">{every.length}</Badge></TabsTrigger>
          <TabsTrigger value="unplaced">Not in diff <Badge variant="secondary">{unplaced.length}</Badge></TabsTrigger>
          <TabsTrigger value="review">Review <Badge variant="secondary">{ctx.reviewThreads.length}</Badge></TabsTrigger>
        </TabsList>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <TabsContent value="file">
            {gate ?? (fileThreads.length ? compareList(fileThreads, compare, false) : <Empty title="No threads in this file" />)}
          </TabsContent>
          <TabsContent value="all">
            <div className="flex flex-wrap items-center gap-2 px-3">
              <label className="sr-only" htmlFor="tp-status">Status</label>
              <NativeSelect size="sm" id="tp-status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
                <option value="open">Open</option><option value="resolved">Resolved</option><option value="all">All</option>
              </NativeSelect>
              <OwnerSelect value={owner} onChange={setOwner} />
            </div>
            {gate ?? (all.length ? compareList(all, compare, true) : <Empty title="No threads" />)}
          </TabsContent>
          <TabsContent value="unplaced">
            {gate ?? (unplaced.length ? compareList(unplaced.map((t) => ({ thread: t })), compare, false) : <Empty title="Every thread has a place in this diff" />)}
          </TabsContent>
          <TabsContent value="review">
            {gate ?? (ctx.reviewThreads.length ? list(ctx.reviewThreads) : <Empty title="No threads on the review" />)}
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

export function ThreadPanel() {
  const { compare } = useReviewCtx();
  return compare ? <CompareThreadPanel compare={compare} /> : <ReviewThreadPanel />;
}

function ReviewThreadPanel() {
  const ctx = useReviewCtx();
  const [tab, setTab] = useThreadTab(ctx.reviewThreads);
  const [composing, setComposing] = useState(false);
  const [status, setStatus] = useState<'open' | 'resolved' | 'all'>('open');
  const [owner, setOwner] = useState<Owner>('all');
  const dropped = useDropped(ctx.id);
  // A past round's threads are unknown until it loads: no tab lists any, nor claims there are none, before then.
  const load = ctx.viewLoad;
  const gate = load && !load.loaded ? load.error ? <ErrorState error={load.error} onRetry={load.reload} /> : <Loading label="Loading threads" rows={3} /> : null;
  const index = useThreadIndex(ctx.id, ctx.files, tab === 'all', ctx.round);
  const fileThreads = ctx.fileDiff.file?.threads ?? [];
  // The file-bound threads, then the review's own: together what the All badge counts.
  const every = [...index.threads, ...ctx.reviewThreads];
  const allThreads = every.filter((t) => (status === 'all' || t.status === status) && ownedBy(t, owner));
  const nextUnread = every.find((t) => t.unread > 0);
  const counts = ctx.threadCounts;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 gap-0">
        <TabsList aria-label="Thread filter" className={FILTER_TABS} onFocus={showFocusedTab}>
          <TabsTrigger value="file">This file</TabsTrigger>
          <TabsTrigger value="all">All <Badge variant="secondary">{counts.open + counts.resolved}</Badge></TabsTrigger>
          <TabsTrigger value="outdated">Outdated <Badge variant="secondary">{ctx.outdatedThreads.length}</Badge></TabsTrigger>
          <TabsTrigger value="review">Review <Badge variant="secondary">{ctx.reviewThreads.length}</Badge></TabsTrigger>
          {dropped.length > 0 && <TabsTrigger value="dropped">Dropped <Badge variant="secondary">{dropped.length}</Badge></TabsTrigger>}
        </TabsList>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <TabsContent value="file">
            {gate ?? (fileThreads.length ? list(fileThreads) : <Empty title="No threads in this file">Select lines in the gutter to start a thread.</Empty>)}
          </TabsContent>
          <TabsContent value="all">
            <div className="flex flex-wrap items-center gap-2 px-3">
              <label className="sr-only" htmlFor="tp-status">Status</label>
              <NativeSelect size="sm" id="tp-status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
                <option value="open">Open</option><option value="resolved">Resolved</option><option value="all">All</option>
              </NativeSelect>
              <OwnerSelect value={owner} onChange={setOwner} />
              <Button size="sm" variant="outline" disabled={!nextUnread} onClick={() => nextUnread && navigate(threadPlace(nextUnread))}>Next unread</Button>
            </div>
            {gate ?? (index.loading && !index.threads.length ? <Loading label="Loading threads" rows={3} />
              : index.error ? <ErrorState error={index.error} />
                : allThreads.length ? list(allThreads, { showLocation: true }) : <Empty title="No threads" />)}
          </TabsContent>
          <TabsContent value="outdated">
            {gate ?? (ctx.outdatedThreads.length ? list(ctx.outdatedThreads, { showLocation: true }) : <Empty title="No outdated threads" />)}
          </TabsContent>
          <TabsContent value="review">
            {!ctx.readOnly && (
              <div className="px-3">
                {composing
                  ? <Composer anchor={{ kind: 'review' }} label="This review" onClose={() => setComposing(false)} />
                  : <Button size="sm" variant="outline" onClick={() => setComposing(true)}><MessageSquarePlusIcon />New review thread</Button>}
              </div>
            )}
            {gate ?? (ctx.reviewThreads.length ? list(ctx.reviewThreads) : <Empty title="No threads on the review">Threads here are about the review as a whole.</Empty>)}
          </TabsContent>
          <TabsContent value="dropped">{list(dropped, { dropped: true })}</TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
