import { MessageSquarePlusIcon } from 'lucide-react';
import { useEffect, useState, type FocusEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { dedupeCopies, type ShownThread } from '@/lib/compare';
import { onFile } from '@/lib/ranges';
import { navigate, useRoute } from '@/lib/route';
import { byPlace, GROUP_LABEL, stateGroup } from '@/lib/threadState';
import type { Thread, UnplacedThread } from '@/lib/types';
import { useDropped } from '@/state/dropped';
import { useReviewCtx } from '@/state/reviewContext';
import { useThreadIndex } from '@/state/threadIndex';
import { Empty, ErrorState, Loading } from '@/features/common/States';
import { CompareNote, UnplacedNote } from '@/features/diff/CompareNote';
import { Composer } from './Composer';
import { ThreadCard, threadPlace } from './ThreadCard';
import { Section, StateSections, ThreadList } from './ThreadList';
import { rowOf } from './ThreadRow';

const clearNeed = () => navigate({ need: undefined }, { replace: true });

// More filter tabs than a narrow pane fits scroll sideways instead of overflowing it; a tab that takes focus (arrow keys)
// is scrolled into view, which Safari does not do by itself.
const FILTER_TABS = 'm-3 w-auto justify-start overflow-x-auto';
const showFocusedTab = (e: FocusEvent<HTMLElement>) => (e.target as HTMLElement).scrollIntoView?.({ inline: 'nearest', block: 'nearest' });

type Owner = 'all' | 'user' | 'agents';
const ownedBy = (t: Pick<Thread, 'openedBy'>, owner: Owner) => owner === 'all' || (t.openedBy.kind === 'human') === (owner === 'user');

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
      const note = reason ? <UnplacedNote reason={reason} /> : onFile(t.anchor) && <CompareNote thread={t} other={other} compare={compare} />;
      return <ThreadCard key={t.id} thread={t} note={note} showLocation={showLocation && !reason} unplaced={!!reason} />;
    })}
  </div>
);

/**
 * When the route names one of the review threads, the Review tab is the one that shows it; otherwise the user's choice.
 * Returns the tab state.
 */
function useThreadTab(reviewThreads: Thread[], initial: 'all' | 'file') {
  const route = useRoute();
  const [tab, setTab] = useState<string>(initial);
  const routedHere = !!route.thread && reviewThreads.some((t) => t.id === route.thread);
  useEffect(() => { if (routedHere) setTab('review'); }, [routedHere, route.thread]);
  return [tab, setTab] as const;
}

/** The thread panel of a comparison: this file's threads, every thread once, the threads its diff has no place for, and the review's own threads. */
function CompareThreadPanel({ compare }: { compare: NonNullable<ReturnType<typeof useReviewCtx>['compare']> }) {
  const ctx = useReviewCtx();
  const [tab, setTab] = useThreadTab(ctx.reviewThreads, 'file');
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

/** `active`: the pane's Threads tab is showing, so the panel may fetch (the tab stays mounted, hidden, while another shows). */
export function ThreadPanel({ active = true }: { active?: boolean }) {
  const { compare } = useReviewCtx();
  return compare ? <CompareThreadPanel compare={compare} /> : <ReviewThreadPanel active={active} />;
}

function ReviewThreadPanel({ active }: { active: boolean }) {
  const ctx = useReviewCtx();
  const [tab, setTabState] = useThreadTab(ctx.reviewThreads, 'all');
  const [composing, setComposing] = useState(false);
  const [status, setStatusState] = useState<'open' | 'resolved' | 'all'>('open');
  const [owner, setOwnerState] = useState<Owner>('all');
  // `need=` (the strip's pills) lists one state group: All, open, any owner. Any other filter choice drops it, so the list never disagrees with the URL.
  const need = useRoute().need;
  useEffect(() => { if (need) { setTabState('all'); setStatusState('open'); setOwnerState('all'); } }, [need, setTabState]);
  const setTab = (v: string) => { clearNeed(); setTabState(v); };
  const setStatus = (v: typeof status) => { clearNeed(); setStatusState(v); };
  const setOwner = (v: Owner) => { clearNeed(); setOwnerState(v); };
  const dropped = useDropped(ctx.id);
  // A past round's threads are unknown until it loads: no tab lists any, nor claims there are none, before then.
  const load = ctx.viewLoad;
  const gate = load && !load.loaded ? load.error ? <ErrorState error={load.error} onRetry={load.reload} /> : <Loading label="Loading threads" rows={3} /> : null;
  // The live review's open threads are the overview's digests: no per-file diff is read for them. Only a resolved list, or a
  // past round or commit (whose threads no digest describes), needs the index, and only while this tab is the one showing.
  const live = !ctx.pastView && !ctx.commit;
  const index = useThreadIndex(ctx.id, ctx.files, active && tab === 'all' && (!live || status !== 'open'), ctx.round);
  const fileThreads = ctx.fileDiff.file?.threads ?? [];
  // Group threads exist only in the live round; the outdated ones are listed with the Outdated tab's.
  const groupThreads = ctx.pastView ? [] : ctx.guide?.threads ?? [];
  const liveGroupThreads = groupThreads.filter((t) => t.status !== 'outdated');
  const outdated = [...ctx.outdatedThreads, ...groupThreads.filter((t) => t.status === 'outdated')];
  // The whole thread behind a row: whichever of these holds it (the routed file's diff, the review's, a group's, the index).
  const pool = [...index.threads, ...ctx.reviewThreads, ...liveGroupThreads];
  const full = (id: string) => [...fileThreads, ...pool, ...outdated].find((t) => t.id === id);
  const openRows = live && status !== 'resolved'
    ? byPlace(ctx.openThreads, ctx.files, ctx.guide).filter((t) => ownedBy(t, owner) && (!need || stateGroup(t.state) === need)) : [];
  const resolvedRows = live && status !== 'open' && !need ? byPlace(pool.filter((t) => t.status === 'resolved' && ownedBy(t, owner)), ctx.files, ctx.guide).map(rowOf) : [];
  const flatRows = live ? [] : byPlace(pool.filter((t) => (status === 'all' || t.status === status) && ownedBy(t, owner)), ctx.files, ctx.guide).map(rowOf);
  const allRows = live ? [...openRows, ...resolvedRows] : flatRows;
  const nextUnread = allRows.find((r) => r.unread > 0);
  const waiting = index.loading && !index.threads.length;
  const resolvedPart = live && status !== 'open' && !need && (waiting ? <Loading label="Loading threads" rows={3} />
    : resolvedRows.length ? <Section label="Resolved" count={resolvedRows.length}><ThreadList rows={resolvedRows} full={full} /></Section> : null);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 gap-0">
        <TabsList aria-label="Thread filter" className={FILTER_TABS} onFocus={showFocusedTab}>
          <TabsTrigger value="file">This file</TabsTrigger>
          <TabsTrigger value="all">All <Badge variant="secondary">{allRows.length}</Badge></TabsTrigger>
          <TabsTrigger value="outdated">Outdated <Badge variant="secondary">{outdated.length}</Badge></TabsTrigger>
          <TabsTrigger value="review">Review <Badge variant="secondary">{ctx.reviewThreads.length}</Badge></TabsTrigger>
          {dropped.length > 0 && <TabsTrigger value="dropped">Dropped <Badge variant="secondary">{dropped.length}</Badge></TabsTrigger>}
        </TabsList>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <TabsContent value="file">
            {gate ?? (fileThreads.length ? <ThreadList rows={fileThreads.map(rowOf)} full={full} /> : <Empty title="No threads in this file">Select lines in the gutter to start a thread.</Empty>)}
          </TabsContent>
          <TabsContent value="all">
            {need && (
              <div className="flex items-center gap-2 px-3 pb-1 text-sm">
                <Badge variant="secondary">Showing: {GROUP_LABEL[need]} · {allRows.length}</Badge>
                <Button size="sm" variant="ghost" className="h-6 px-2" aria-label="Show all threads" onClick={clearNeed}>✕</Button>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 px-3 pb-1">
              <label className="sr-only" htmlFor="tp-status">Status</label>
              <NativeSelect size="sm" id="tp-status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
                <option value="open">Open</option><option value="resolved">Resolved</option><option value="all">All</option>
              </NativeSelect>
              <OwnerSelect value={owner} onChange={setOwner} />
              <Button size="sm" variant="outline" disabled={!nextUnread} onClick={() => nextUnread && navigate(threadPlace(nextUnread))}>Next unread</Button>
            </div>
            {gate ?? (index.error ? <ErrorState error={index.error} />
              : live ? (
                <>
                  <StateSections rows={openRows} full={full} />
                  {resolvedPart}
                  {!allRows.length && !waiting && <Empty title="No threads" />}
                </>
              ) : waiting ? <Loading label="Loading threads" rows={3} />
                : flatRows.length ? <ThreadList rows={flatRows} full={full} /> : <Empty title="No threads" />)}
          </TabsContent>
          <TabsContent value="outdated">
            {gate ?? (outdated.length ? <ThreadList rows={outdated.map(rowOf)} full={full} /> : <Empty title="No outdated threads" />)}
          </TabsContent>
          <TabsContent value="review">
            {!ctx.readOnly && (
              <div className="px-3 pb-1.5">
                {composing
                  ? <Composer anchor={{ kind: 'review' }} label="This review" onClose={() => setComposing(false)} />
                  : <Button size="sm" variant="outline" onClick={() => setComposing(true)}><MessageSquarePlusIcon />New review thread</Button>}
              </div>
            )}
            {gate ?? (ctx.reviewThreads.length ? <ThreadList rows={ctx.reviewThreads.map(rowOf)} full={full} /> : <Empty title="No threads on the review">Threads here are about the review as a whole.</Empty>)}
          </TabsContent>
          <TabsContent value="dropped">{list(dropped, { dropped: true })}</TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
