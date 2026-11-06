import { useEffect, useId, useMemo, useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { fileSummary } from '@/lib/guide';
import { onLines } from '@/lib/ranges';
import { useRoute } from '@/lib/route';
import { selectionTouches } from '@/lib/selection';
import type { GuideHunk as GuideHunkRef, TextHunk } from '@/lib/types';
import { useDiffEntry } from '@/state/diffResource';
import { setFileOpen, useOpenFiles } from '@/state/guideOpenFiles';
import { useReviewCtx } from '@/state/reviewContext';
import { ErrorState, Loading } from '@/features/common/States';
import { useCollapse } from '@/features/diff/useCollapse';
import { GuideHunk } from './GuideHunk';

/**
 * One file's share of a step: the step's hunks of that file, read from the file's cached diff (the same entry the file view
 * uses). Accepted hunks and resolved line threads collapse like they do there, per section, reset on each step.
 */
function LoadedSection({ path, hunks: refs, stepKey }: { path: string; hunks: GuideHunkRef[]; stepKey: string }) {
  const ctx = useReviewCtx();
  const route = useRoute();
  const hunkIds = useMemo(() => refs.map((h) => h.id), [refs]);
  const sig = ctx.files.find((f) => f.path === path)?.sig;
  const entry = useDiffEntry(ctx.id, undefined, path, sig);
  const file = entry.data;
  const shown = useMemo(() => hunkIds.map((id) => ({ id, hunk: file?.hunks.find((h) => h.id === id) })), [hunkIds, file]);
  const here = useMemo(() => {
    if (!file) return [];
    const hunks = shown.flatMap((s) => (s.hunk?.kind === 'text' ? [s.hunk as TextHunk] : []));
    return file.threads.filter(onLines).filter((t) => hunks.some((h) => selectionTouches({ side: t.anchor.side, start: t.anchor.startLine, end: t.anchor.endLine }, h.lines)));
  }, [file, shown]);
  const settled = useMemo(() => {
    if (!file) return [];
    const hunks = shown.flatMap((s) => (s.hunk?.kind === 'text' ? [s.hunk as TextHunk] : []));
    return [...hunks.filter((h) => h.verdict === 'accepted').map((h) => `h:${h.id}`), ...here.filter((t) => t.status === 'resolved').map((t) => `t:${t.id}`)];
  }, [file, shown, here]);
  const openThreads = file ? here.filter((t) => t.status === 'open').length : 0;
  const stored = useOpenFiles(ctx.id, stepKey).has(path);
  const [released, setReleased] = useState<string | null>(null);
  const routedHere = !!route.thread && here.some((t) => t.id === route.thread);
  const isForced = routedHere && released !== route.thread;
  const open = stored || isForced;
  useEffect(() => { if (isForced) setFileOpen(ctx.id, stepKey, path, true); }, [isForced, ctx.id, stepKey, path]);
  const toggle = () => {
    if (open) {
      setFileOpen(ctx.id, stepKey, path, false);
      if (isForced) setReleased(route.thread!);
    } else setFileOpen(ctx.id, stepKey, path, true);
  };
  const bodyId = useId();
  const noForced = useMemo(() => new Set<string>(), []);
  const collapse = useCollapse({ settled, forced: noForced, pinned: route.thread ? `t:${route.thread}` : null, resetKey: `${ctx.id}:${stepKey}:${path}`, keepOpen: () => false });
  return (
    <section aria-label={path} className="border-t">
      <h3 className="sticky top-[var(--step-header-h,0px)] z-[5] border-b bg-muted text-xs">
        <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={toggle}
          className="flex w-full min-w-0 items-center gap-2 px-3 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {open ? <ChevronDownIcon className="size-3.5 shrink-0" aria-hidden /> : <ChevronRightIcon className="size-3.5 shrink-0" aria-hidden />}
          <span className="min-w-0 flex-1 truncate font-mono font-medium" title={path}>{path}</span>
          <span className="shrink-0 text-muted-foreground">{fileSummary(refs, openThreads)}</span>
        </button>
      </h3>
      <div id={bodyId} hidden={!open}>
        {!file ? (entry.error ? <ErrorState error={entry.error} onRetry={entry.reload} /> : <Loading label={`Loading ${path}`} rows={3} />)
          : shown.map(({ id, hunk }) => (hunk
            ? <GuideHunk key={id} file={file} hunk={hunk} collapse={collapse} />
            : <p key={id} className="px-3 py-2 text-xs text-muted-foreground">This hunk is no longer in the file</p>))}
      </div>
    </section>
  );
}

/** `path` null: the snapshot is unreadable, so the hunks' files are unknown. */
export function GuideFileSection({ path, hunks, stepKey }: { path: string | null; hunks: GuideHunkRef[]; stepKey: string }) {
  const { review } = useReviewCtx();
  if (path === null) {
    return <section aria-label="Unknown file" className="border-t"><ErrorState error={{ code: review.snapshotError ?? 'SNAPSHOT_GONE', reason: '' }} /></section>;
  }
  return <LoadedSection path={path} hunks={hunks} stepKey={stepKey} />;
}
