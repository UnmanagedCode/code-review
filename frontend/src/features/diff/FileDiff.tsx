import { ArrowLeftIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { collapseRows, type Row } from '@/lib/diffRows';
import { formatLines, navigate, parseLines, useRoute } from '@/lib/route';
import { lineOn, selectionTouches, type Selection } from '@/lib/selection';
import { pairLine, splitRows, type SplitRow as SplitRowT } from '@/lib/splitRows';
import type { DiffFile, DiffLine, Side, TextHunk, Thread } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useDropped } from '@/state/dropped';
import { useReviewCtx } from '@/state/reviewContext';
import { Empty, ErrorState, Loading } from '@/features/common/States';
import { Composer } from '@/features/threads/Composer';
import { CitedExcerpt } from './CitedExcerpt';
import { FileVerdict } from './FileVerdict';
import { GapRow } from './GapRow';
import { HunkBar } from './HunkBar';
import { HunkHeader } from './HunkHeader';
import { InlineRow } from './InlineRow';
import { SettledThread } from './SettledThread';
import { SplitRow } from './SplitRow';
import { useCollapse } from './useCollapse';
import { useDiffView, type DiffView } from './useDiffView';
import { useLineSelection } from './useLineSelection';
import { ViewToggle } from './ViewToggle';

export const CHUNK_ROWS = 1500;
const byId = (a: Thread, b: Thread) => a.id.localeCompare(b.id, undefined, { numeric: true });

function FileHeader({ file, files, onBack, extra, view }: { file: DiffFile; files: { path: string }[]; onBack?: () => void; extra?: ReactNode; view?: { chosen: DiffView; choose: (v: DiffView) => void } }) {
  const { round } = useReviewCtx();
  const i = files.findIndex((f) => f.path === file.path);
  const go = (path: string) => navigate({ file: path, lines: undefined, side: undefined, thread: undefined });
  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b bg-background px-3 py-2">
      {onBack && <Button variant="ghost" size="icon-sm" aria-label="Back to files" onClick={onBack}><ArrowLeftIcon /></Button>}
      <div className="min-w-0 flex-1 basis-24">
        <p className="truncate font-mono text-sm font-medium" title={file.path}>{file.path}</p>
        {file.oldPath && <p className="truncate font-mono text-xs text-muted-foreground">renamed from {file.oldPath}</p>}
      </div>
      {round !== undefined && <Badge variant="info">round {round} · read-only</Badge>}
      <Badge variant="outline">{file.status}</Badge>
      <span className="text-xs"><span className="text-success">+{file.additions}</span> <span className="text-destructive">−{file.deletions}</span></span>
      <FileVerdict file={file} />
      {view && <ViewToggle view={view.chosen} onChange={view.choose} />}
      <Button variant="ghost" size="icon-sm" aria-label="Previous file" disabled={i <= 0} onClick={() => go(files[i - 1].path)}><ChevronLeftIcon /></Button>
      <Button variant="ghost" size="icon-sm" aria-label="Next file" disabled={i < 0 || i >= files.length - 1} onClick={() => go(files[i + 1].path)}><ChevronRightIcon /></Button>
      {extra}
    </div>
  );
}

export function FileDiff({ onBack, extra }: { onBack?: () => void; extra?: ReactNode } = {}) {
  const ctx = useReviewCtx();
  const { file, rows, loading, error, expand, reveal, reload } = ctx.fileDiff;
  const route = useRoute();
  const dropped = useDropped(ctx.id);
  const textFile = !!file && !file.binary && !file.tooLarge;
  const resetKey = `${ctx.id}:${file?.path}`;
  const [limit, setLimit] = useState(CHUNK_ROWS);
  const target = route.lines ? parseLines(route.lines) : null;
  const targetSide: Side = route.side ?? 'new';
  const targetSel = useMemo<Selection | null>(() => {
    const t = route.lines ? parseLines(route.lines) : null;
    return t ? { side: targetSide, start: t.start, end: t.end, anchorLine: t.start } : null;
  }, [route.lines, targetSide]);
  const diffView = useDiffView();

  // Accepted hunks and resolved threads collapse; the routed thread and the hunks holding the cited range never do.
  const textHunks = useMemo(() => (file?.hunks ?? []).filter((h): h is TextHunk => h.kind === 'text'), [file]);
  const settled = useMemo(() => [
    ...textHunks.filter((h) => h.verdict === 'accepted').map((h) => `h:${h.id}`),
    ...(file?.threads ?? []).filter((t) => t.status === 'resolved').map((t) => `t:${t.id}`),
  ], [file, textHunks]);
  const forced = useMemo(() => new Set([
    ...(route.thread ? [`t:${route.thread}`] : []),
    ...textHunks.filter((h) => selectionTouches(targetSel, h.lines)).map((h) => `h:${h.id}`),
  ]), [route.thread, targetSel, textHunks]);
  // The previous render's selection: a settle comes from a verdict change, which never changes the selection.
  const selRef = useRef<Selection | null>(null);
  const collapse = useCollapse({
    settled, forced, resetKey,
    keepOpen: (id) => textHunks.some((h) => `h:${h.id}` === id && selectionTouches(selRef.current, h.lines)),
  });
  const visible = useMemo(() => collapseRows(rows, (id) => collapse.collapsed.has(`h:${id}`)), [rows, collapse.collapsed]);
  const sel = useLineSelection(visible, textFile && !ctx.readOnly, resetKey);
  selRef.current = sel.selection;

  const threadsByRow = useMemo(() => {
    const m = new Map<string, Thread[]>();
    for (const t of file?.threads ?? []) {
      const key = `${t.anchor.side}:${t.anchor.endLine}`;
      m.set(key, [...(m.get(key) ?? []), t].sort(byId));
    }
    return m;
  }, [file]);
  const tombstones = useMemo(() => {
    const m = new Map<string, Thread[]>();
    for (const t of dropped.filter((d) => d.anchor.file === file?.path)) {
      const key = `${t.anchor.side}:${t.anchor.endLine}`;
      m.set(key, [...(m.get(key) ?? []), t]);
    }
    return m;
  }, [dropped, file?.path]);

  // Open context that hides a thread, or the cited lines.
  const revealKey = `${file?.path}|${file?.threads.map((t) => t.id).join()}|${route.lines}|${targetSide}|${ctx.fileDiff.total}`;
  useEffect(() => {
    if (!file) return;
    const wanted = file.threads.map((t) => ({ side: t.anchor.side, n: t.anchor.endLine }));
    if (target) wanted.push({ side: targetSide, n: target.start }, { side: targetSide, n: target.end });
    reveal(wanted);
  }, [revealKey]);

  // A target beyond the rendered window widens it.
  useEffect(() => {
    const wantLine = target?.start;
    const wantThread = route.thread ? [...(file?.threads ?? [])].find((t) => t.id === route.thread)?.anchor : null;
    const idx = visible.findIndex((r) => (wantLine != null && lineOn(r, targetSide) === wantLine) || (wantThread && lineOn(r, wantThread.side) === wantThread.endLine));
    if (idx >= limit) setLimit(idx + 200);
  }, [visible, route.lines, route.thread]);
  useEffect(() => { setLimit(CHUNK_ROWS); }, [file?.path]);
  useEffect(() => {
    if (!target) return;
    document.querySelector<HTMLElement>('[data-line-target]')?.scrollIntoView?.({ block: 'center' });
  }, [route.lines, visible.length]);

  if (!route.file) return <Empty title="Select a file to see its changes" />;
  if (loading) return <Loading label="Loading diff" rows={8} />;
  if ((error as { code?: string } | undefined)?.code === 'FILE_NOT_IN_DIFF') return <CitedExcerpt path={route.file} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!file) return <Empty title="That file isn’t in this diff" />;

  const split = diffView.view === 'split';
  const shown = visible.slice(0, limit);
  const items: (Row | SplitRowT)[] = split ? splitRows(shown) : shown;
  const blocks: (Row | SplitRowT)[][] = [];
  for (const r of items) {
    if (r.kind === 'hunk' || !blocks.length) blocks.push([r]);
    else blocks[blocks.length - 1].push(r);
  }
  const lastGap = [...visible].reverse().find((r) => r.kind === 'gap');
  const enabled = !ctx.readOnly;

  /** What renders under a row: tombstone notices, thread cards, then the selection toolbar or composer. */
  const belowRow = (keys: string[], endsSelection: boolean) => {
    const threads = keys.flatMap((k) => threadsByRow.get(k) ?? []);
    const notices = keys.flatMap((k) => tombstones.get(k) ?? []);
    return (
      <>
        {notices.map((t) => <p key={t.id} className="px-3 py-1 font-sans text-xs text-muted-foreground">Thread {t.id} dropped: its lines changed</p>)}
        {threads.length > 0 && (
          <div className="sticky left-0 flex flex-col gap-2 px-3 py-2 font-sans text-sm">
            {threads.map((t) => (
              <SettledThread key={t.id} thread={t} collapsed={collapse.collapsed.has(`t:${t.id}`)} toggleable={collapse.toggleable(`t:${t.id}`)} onToggle={(open) => collapse.setOpen(`t:${t.id}`, open)} />
            ))}
          </div>
        )}
        {endsSelection && sel.selection && !sel.dragging && (
          <div className="sticky left-0 px-3 py-2 font-sans text-sm">
            {sel.composing ? (
              <Composer
                anchor={{ file: file.path, side: sel.selection.side, startLine: sel.selection.start, endLine: sel.selection.end }}
                label={`${selectionLabel(sel.selection)}`}
                onClose={sel.clear}
              />
            ) : (
              <div role="toolbar" aria-label="Selection" className="flex flex-wrap items-center gap-2 rounded-md border bg-card px-3 py-1.5">
                <span>{selectionLabel(sel.selection)}</span>
                <Button size="sm" onClick={sel.openComposer}>Comment</Button>
                <Button size="sm" variant="ghost" onClick={sel.clear}>Clear</Button>
              </div>
            )}
          </div>
        )}
      </>
    );
  };

  const render = (r: Row | SplitRowT, bi: number) => {
    if (r.kind === 'hunk') {
      const id = `h:${r.hunk.id}`;
      // No collapse over the selection: it would stay selected but hidden and inert.
      const toggleable = collapse.toggleable(id) && (r.collapsed || !selectionTouches(sel.selection, r.hunk.lines));
      return (
        <Fragment key={r.key}>
          <HunkHeader row={r} toggleable={toggleable} onToggle={(open) => collapse.setOpen(id, open)} />
          {r.collapsed && belowRow(keysOf(r.hunk.lines), false)}
        </Fragment>
      );
    }
    if (r.kind === 'gap') {
      return <GapRow key={r.key} row={r} first={r.gapKey === 'pre'} last={r === lastGap && r.gapKey.startsWith('after:') && bi === blocks.length - 1} readOnly={!!ctx.commit} onExpand={(how) => expand(r.gapKey, how)} />;
    }
    const s = sel.selection;
    if (r.kind === 'pair') {
      return (
        <Fragment key={r.key}>
          <SplitRow pair={r} sel={sel} enabled={enabled} target={targetSel} />
          {belowRow([`old:${r.left?.old}`, `new:${r.right?.new}`], !!s && pairLine(r, s.side) === s.end)}
        </Fragment>
      );
    }
    return (
      <Fragment key={r.key}>
        <InlineRow line={r.line} sel={sel} enabled={enabled} target={targetSel} />
        {belowRow(keysOf([r.line]), !!s && lineOn(r, s.side) === s.end)}
      </Fragment>
    );
  };

  return (
    <div ref={diffView.paneRef} className="flex min-w-0 flex-col">
      <FileHeader file={file} files={ctx.files} onBack={onBack} extra={extra} view={textFile && diffView.available ? diffView : undefined} />
      {!textFile && (
        <div className="flex flex-col gap-2 p-3">
          <p className="text-sm text-muted-foreground">{file.binary ? 'Binary file changed' : 'Too large to diff'}</p>
          {file.hunks.map((h) => <HunkBar key={h.id} hunk={h} commentable={false} />)}
        </div>
      )}
      {textFile && (
        <div ref={sel.grid} role="grid" aria-label={`Changes in ${file.path}`} aria-multiselectable className="font-mono text-xs leading-5 pointer-coarse:leading-7">
          {blocks.map((block, bi) => (
            <div key={block[0].key} role="rowgroup" className={cn(!split && 'overflow-x-auto', '[contain-intrinsic-size:auto_400px] [content-visibility:auto]')}>
              {block.map((r) => render(r, bi))}
            </div>
          ))}
          {visible.length > limit && (
            <div className="p-3">
              <Button variant="outline" size="sm" onClick={() => setLimit(limit + CHUNK_ROWS)}>Show next {CHUNK_ROWS} lines ({visible.length - limit} left)</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The thread keys of `lines`, in line order: each line's old side, then its new side (inline's order). */
const keysOf = (lines: DiffLine[]) => lines.flatMap((l) => [`old:${l.old}`, `new:${l.new}`]);

function selectionLabel(s: { side: Side; start: number; end: number }): string {
  return `L${formatLines(s.start, s.end).replace('-', '–L')} (${s.side})`;
}
