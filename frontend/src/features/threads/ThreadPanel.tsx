import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { navigate } from '@/lib/route';
import type { Thread } from '@/lib/types';
import { useDropped } from '@/state/dropped';
import { useReviewCtx } from '@/state/reviewContext';
import { useThreadIndex } from '@/state/threadIndex';
import { Empty, ErrorState, Loading } from '@/features/common/States';
import { ThreadCard } from './ThreadCard';

const list = (threads: Thread[], opts: { dropped?: boolean; showLocation?: boolean } = {}) => (
  <div className="flex flex-col gap-3 p-3">{threads.map((t) => <ThreadCard key={t.id} thread={t} {...opts} />)}</div>
);

export function ThreadPanel() {
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
          {ctx.unplacedThreads.length > 0 && <TabsTrigger value="unplaced">Position unknown <Badge variant="secondary">{ctx.unplacedThreads.length}</Badge></TabsTrigger>}
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
          <TabsContent value="unplaced">{list(ctx.unplacedThreads, { showLocation: false })}</TabsContent>
          <TabsContent value="dropped">{list(dropped, { dropped: true })}</TabsContent>
        </div>
      </Tabs>
    </section>
  );
}
