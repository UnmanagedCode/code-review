import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { dedupeCopies, type ShownThread } from '@/lib/compare';
import { navigate } from '@/lib/route';
import type { Thread, UnplacedThread } from '@/lib/types';
import { useDropped } from '@/state/dropped';
import { useReviewCtx } from '@/state/reviewContext';
import { useThreadIndex } from '@/state/threadIndex';
import { Empty, ErrorState, Loading } from '@/features/common/States';
import { CompareNote, UnplacedNote } from '@/features/diff/CompareNote';
import { ThreadCard } from './ThreadCard';

const list = (threads: Thread[], opts: { dropped?: boolean; showLocation?: boolean } = {}) => (
  <div className="flex flex-col gap-3 p-3">{threads.map((t) => <ThreadCard key={t.id} thread={t} {...opts} />)}</div>
);

/** Comparison cards, one per thread, each noting where its copies sit (or why it has no place). */
const compareList = (shown: ShownThread[], compare: { from: number; to: number }, showLocation: boolean) => (
  <div className="flex flex-col gap-3 p-3">
    {shown.map(({ thread: t, other }) => {
      const reason = (t as Partial<UnplacedThread>).reason;
      const note = reason ? <UnplacedNote reason={reason} /> : <CompareNote thread={t} other={other} compare={compare} />;
      return <ThreadCard key={t.id} thread={t} note={note} showLocation={showLocation && !reason} />;
    })}
  </div>
);

/** The thread panel of a comparison: this file's threads, every thread once, and the threads its diff has no place for. */
function CompareThreadPanel({ compare }: { compare: NonNullable<ReturnType<typeof useReviewCtx>['compare']> }) {
  const ctx = useReviewCtx();
  const [tab, setTab] = useState('file');
  const [status, setStatus] = useState<'open' | 'resolved' | 'all'>('open');
  const view = compare.view;
  const unplaced = view?.unplaced ?? [];
  const fileThreads = dedupeCopies(ctx.fileDiff.file?.threads ?? []);
  // Every compared thread once; one outdated by round B is listed too, as its round-A copy.
  const every = dedupeCopies([...(view?.files.flatMap((f) => f.threads) ?? []), ...unplaced])
    .sort((a, b) => a.thread.id.localeCompare(b.thread.id, undefined, { numeric: true }));
  const all = every.filter((s) => status === 'all' || s.thread.status === status);
  return (
    <section aria-label="Threads" className="flex min-h-0 flex-1 flex-col">
      <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 gap-0">
        <TabsList className="m-3 w-auto">
          <TabsTrigger value="file">This file</TabsTrigger>
          <TabsTrigger value="all">All <Badge variant="secondary">{every.length}</Badge></TabsTrigger>
          <TabsTrigger value="unplaced">Not in diff <Badge variant="secondary">{unplaced.length}</Badge></TabsTrigger>
        </TabsList>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <TabsContent value="file">
            {fileThreads.length ? compareList(fileThreads, compare, false) : <Empty title="No threads in this file" />}
          </TabsContent>
          <TabsContent value="all">
            <div className="flex flex-wrap items-center gap-2 px-3">
              <label className="sr-only" htmlFor="tp-status">Status</label>
              <NativeSelect size="sm" id="tp-status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
                <option value="open">Open</option><option value="resolved">Resolved</option><option value="all">All</option>
              </NativeSelect>
            </div>
            {!view ? <Loading label="Loading threads" rows={3} /> : all.length ? compareList(all, compare, true) : <Empty title="No threads" />}
          </TabsContent>
          <TabsContent value="unplaced">
            {unplaced.length ? compareList(unplaced.map((t) => ({ thread: t })), compare, false) : <Empty title="Every thread has a place in this diff" />}
          </TabsContent>
        </div>
      </Tabs>
    </section>
  );
}

export function ThreadPanel() {
  const { compare } = useReviewCtx();
  return compare ? <CompareThreadPanel compare={compare} /> : <ReviewThreadPanel />;
}

function ReviewThreadPanel() {
  const ctx = useReviewCtx();
  const [tab, setTab] = useState('file');
  const [status, setStatus] = useState<'open' | 'resolved' | 'all'>('open');
  const dropped = useDropped(ctx.id);
  const index = useThreadIndex(ctx.id, ctx.files, ctx.version, tab === 'all', ctx.round);
  const fileThreads = ctx.fileDiff.file?.threads ?? [];
  const allThreads = index.threads.filter((t) => status === 'all' || t.status === status);
  const nextUnread = index.threads.find((t) => t.unread > 0);
  const counts = ctx.threadCounts;
  return (
    <section aria-label="Threads" className="flex min-h-0 flex-1 flex-col">
      <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 gap-0">
        <TabsList className="m-3 w-auto">
          <TabsTrigger value="file">This file</TabsTrigger>
          <TabsTrigger value="all">All <Badge variant="secondary">{counts.open + counts.resolved}</Badge></TabsTrigger>
          <TabsTrigger value="outdated">Outdated <Badge variant="secondary">{ctx.outdatedThreads.length}</Badge></TabsTrigger>
          {dropped.length > 0 && <TabsTrigger value="dropped">Dropped <Badge variant="secondary">{dropped.length}</Badge></TabsTrigger>}
        </TabsList>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <TabsContent value="file">
            {fileThreads.length ? list(fileThreads) : <Empty title="No threads in this file">Select lines in the gutter to start a thread.</Empty>}
          </TabsContent>
          <TabsContent value="all">
            <div className="flex flex-wrap items-center gap-2 px-3">
              <label className="sr-only" htmlFor="tp-status">Status</label>
              <NativeSelect size="sm" id="tp-status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
                <option value="open">Open</option><option value="resolved">Resolved</option><option value="all">All</option>
              </NativeSelect>
              <Button size="sm" variant="outline" disabled={!nextUnread} onClick={() => nextUnread && navigate({ file: nextUnread.anchor.file, side: nextUnread.anchor.side, lines: `${nextUnread.anchor.startLine}`, thread: nextUnread.id })}>Next unread</Button>
            </div>
            {index.loading && !index.threads.length ? <Loading label="Loading threads" rows={3} />
              : index.error ? <ErrorState error={index.error} />
                : allThreads.length ? list(allThreads, { showLocation: true }) : <Empty title="No threads" />}
          </TabsContent>
          <TabsContent value="outdated">
            {ctx.outdatedThreads.length ? list(ctx.outdatedThreads, { showLocation: false }) : <Empty title="No outdated threads" />}
          </TabsContent>
          <TabsContent value="dropped">{list(dropped, { dropped: true })}</TabsContent>
        </div>
      </Tabs>
    </section>
  );
}
