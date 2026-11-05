import { useMemo } from 'react';
import { onLines } from '@/lib/ranges';
import { useRoute } from '@/lib/route';
import { selectionTouches } from '@/lib/selection';
import type { TextHunk } from '@/lib/types';
import { useDiffEntry } from '@/state/diffResource';
import { useReviewCtx } from '@/state/reviewContext';
import { ErrorState, Loading } from '@/features/common/States';
import { useCollapse } from '@/features/diff/useCollapse';
import { GuideHunk } from './GuideHunk';

/**
 * One file's share of a step: the step's hunks of that file, read from the file's cached diff (the same entry the file view
 * uses). Accepted hunks and resolved line threads collapse like they do there, per section, reset on each step.
 */
function LoadedSection({ path, hunkIds, stepKey }: { path: string; hunkIds: string[]; stepKey: string }) {
  const ctx = useReviewCtx();
  const route = useRoute();
  const sig = ctx.files.find((f) => f.path === path)?.sig;
  const entry = useDiffEntry(ctx.id, undefined, path, sig);
  const file = entry.data;
  const shown = useMemo(() => hunkIds.map((id) => ({ id, hunk: file?.hunks.find((h) => h.id === id) })), [hunkIds, file]);
  const settled = useMemo(() => {
    if (!file) return [];
    const hunks = shown.flatMap((s) => (s.hunk?.kind === 'text' ? [s.hunk as TextHunk] : []));
    const resolved = file.threads.filter(onLines).filter((t) => t.status === 'resolved'
      && hunks.some((h) => selectionTouches({ side: t.anchor.side, start: t.anchor.startLine, end: t.anchor.endLine }, h.lines)));
    return [...hunks.filter((h) => h.verdict === 'accepted').map((h) => `h:${h.id}`), ...resolved.map((t) => `t:${t.id}`)];
  }, [file, shown]);
  const forced = useMemo(() => new Set<string>(), []);
  const collapse = useCollapse({ settled, forced, pinned: route.thread ? `t:${route.thread}` : null, resetKey: `${ctx.id}:${stepKey}:${path}`, keepOpen: () => false });
  return (
    <section aria-label={path} className="border-t">
      <h3 className="sticky top-[var(--step-header-h,0px)] z-[5] truncate border-b bg-muted px-3 py-1 font-mono text-xs font-medium" title={path}>{path}</h3>
      {!file ? (entry.error ? <ErrorState error={entry.error} onRetry={entry.reload} /> : <Loading label={`Loading ${path}`} rows={3} />)
        : shown.map(({ id, hunk }) => (hunk
          ? <GuideHunk key={id} file={file} hunk={hunk} collapse={collapse} />
          : <p key={id} className="px-3 py-2 text-xs text-muted-foreground">This hunk is no longer in the file</p>))}
    </section>
  );
}

/** `path` null: the snapshot is unreadable, so the hunks' files are unknown. */
export function GuideFileSection({ path, hunkIds, stepKey }: { path: string | null; hunkIds: string[]; stepKey: string }) {
  const { review } = useReviewCtx();
  if (path === null) {
    return <section aria-label="Unknown file" className="border-t"><ErrorState error={{ code: review.snapshotError ?? 'SNAPSHOT_GONE', reason: '' }} /></section>;
  }
  return <LoadedSection path={path} hunkIds={hunkIds} stepKey={stepKey} />;
}
