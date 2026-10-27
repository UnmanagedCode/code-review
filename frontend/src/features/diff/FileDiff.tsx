import { ArrowLeftIcon, ChevronLeftIcon, ChevronRightIcon, MessageSquarePlusIcon } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { dedupeCopies, type ShownThread } from '@/lib/compare';
import { decorateRows } from '@/lib/decorate';
import { collapseRows, type Row } from '@/lib/diffRows';
import { languageFor } from '@/lib/highlight';
import { onLines, rangeLabel, rangeMarks } from '@/lib/ranges';
import { navigate, parseLines, useRoute } from '@/lib/route';
import { lineOn, selectionTouches, type Selection } from '@/lib/selection';
import { pairLine, splitRows, type SplitRow as SplitRowT } from '@/lib/splitRows';
import type { DiffFile, DiffLine, Side, TextHunk, Thread } from '@/lib/types';
import { cn } from '@/lib/utils';
import { isWhitespaceOnly } from '@/lib/whitespace';
import { useDiffPrefs } from '@/state/diffPrefs';
import { useDropped } from '@/state/dropped';
import { useReviewCtx } from '@/state/reviewContext';
import { CodeGitFileLink } from '@/features/common/CodeGitLink';
import { Empty, ErrorState, Loading } from '@/features/common/States';
import { Composer } from '@/features/threads/Composer';
import { CitedExcerpt } from './CitedExcerpt';
import { CompareNote } from './CompareNote';
import { DiffOptions } from './DiffOptions';
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
import { useTokenizer } from './useTokenizer';
import { ViewToggle } from './ViewToggle';

export const CHUNK_ROWS = 1500;
const byId = (a: Thread, b: Thread) => a.id.localeCompare(b.id, undefined, { numeric: true });

function FileHeader({ ref, file, files, onBack, extra, view, options, onComment }: { ref?: Ref<HTMLDivElement>; file: DiffFile; files: { path: string }[]; onBack?: () => void; extra?: ReactNode; view?: { chosen: DiffView; choose: (v: DiffView) => void }; options: boolean; onComment?: () => void }) {
  const { round, compare } = useReviewCtx();
  const i = files.findIndex((f) => f.path === file.path);
  const go = (path: string) => navigate({ file: path, lines: undefined, side: undefined, thread: undefined });
  return (
    <div ref={ref} className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b bg-background px-3 py-2">
      {onBack && <Button variant="ghost" size="icon-sm" aria-label="Back to files" onClick={onBack}><ArrowLeftIcon /></Button>}
      <div className="min-w-0 flex-1 basis-24">
        <p className="truncate font-mono text-sm font-medium" title={file.path}>{file.path}</p>
        {file.oldPath && <p className="truncate font-mono text-xs text-muted-foreground">renamed from {file.oldPath}</p>}
      </div>
      {round !== undefined && <Badge variant="info">round {round} · read-only</Badge>}
      {compare && <Badge variant="info">round {compare.from} → {compare.to} · read-only</Badge>}
      <Badge variant="outline">{file.status}</Badge>
      <span className="text-xs"><span className="text-success">+{file.additions}</span> <span className="text-destructive">−{file.deletions}</span></span>
      <FileVerdict file={file} />
      <CodeGitFileLink file={file} />
      {onComment && <Button variant="ghost" size="icon-sm" aria-label="Comment on file" title="Comment on file" onClick={onComment}><MessageSquarePlusIcon /></Button>}
      {view && <ViewToggle view={view.chosen} onChange={view.choose} />}
      {options && <DiffOptions />}
      <Button variant="ghost" size="icon-sm" aria-label="Previous file" disabled={i <= 0} onClick={() => go(files[i - 1].path)}><ChevronLeftIcon /></Button>
      <Button variant="ghost" size="icon-sm" aria-label="Next file" disabled={i < 0 || i >= files.length - 1} onClick={() => go(files[i + 1].path)}><ChevronRightIcon /></Button>
      {extra}
    </div>
  );
}

export function FileDiff({ onBack, extra }: { onBack?: () => void; extra?: ReactNode } = {}) {
  const ctx = useReviewCtx();
  const { file, rows, side, loading, switching, error, expand, reveal, reload } = ctx.fileDiff;
  const prefs = useDiffPrefs();
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

  // Accepted hunks, whitespace-only hunks while Ignore whitespace is on, and resolved threads collapse; the hunks holding
  // the routed thread's range or the cited range never do. The routed thread is shown on arrival but collapses if it gets resolved while routed.
  // A whitespace-only hunk holding an open thread stays expanded: that collapse is automatic, so it never hides a conversation.
  const textHunks = useMemo(() => (file?.hunks ?? []).filter((h): h is TextHunk => h.kind === 'text'), [file]);
  // Threads on lines sit under rows; threads on the whole file sit in the block under the header.
  const lineThreads = useMemo(() => (file?.threads ?? []).filter(onLines), [file]);
  const fileThreads = useMemo(() => dedupeCopies((file?.threads ?? []).filter((t) => t.anchor.kind === 'file')), [file]);
  const settled = useMemo(() => {
    const open = lineThreads.filter((t) => t.status === 'open').map((t) => ({ side: t.anchor.side, start: t.anchor.startLine, end: t.anchor.endLine }));
    const wsOnly = new Set(rows.flatMap((r) => (r.kind === 'hunk' && isWhitespaceOnly(r.hunk) && !open.some((s) => selectionTouches(s, r.hunk.lines)) ? [r.hunk.id] : [])));
    return [
      ...textHunks.filter((h) => h.verdict === 'accepted' || wsOnly.has(h.id)).map((h) => `h:${h.id}`),
      ...(file?.threads ?? []).filter((t) => t.status === 'resolved').map((t) => `t:${t.id}`),
    ];
  }, [file, lineThreads, textHunks, rows]);
  const routed = useMemo(() => {
    const a = route.thread ? lineThreads.find((t) => t.id === route.thread)?.anchor : undefined;
    return a ? { side: a.side, start: a.startLine, end: a.endLine } : null;
  }, [lineThreads, route.thread]);
  const forced = useMemo(() => new Set([
    ...textHunks.filter((h) => selectionTouches(targetSel, h.lines) || selectionTouches(routed, h.lines)).map((h) => `h:${h.id}`),
  ]), [route.thread, routed, targetSel, textHunks]);
  // The previous render's selection: a settle comes from a verdict change, which never changes the selection.
  const selRef = useRef<Selection | null>(null);
  const collapse = useCollapse({
    settled, forced, pinned: route.thread ? `t:${route.thread}` : null, resetKey,
    keepOpen: (id) => textHunks.some((h) => `h:${h.id}` === id && selectionTouches(selRef.current, h.lines)),
  });
  const visible = useMemo(() => collapseRows(rows, (id) => collapse.collapsed.has(`h:${id}`)), [rows, collapse.collapsed]);
  const sel = useLineSelection(visible, textFile && !ctx.readOnly, resetKey);
  selRef.current = sel.selection;
  const marks = useMemo(() => rangeMarks(file?.threads ?? [], route.thread), [file, route.thread]);
  const tokenize = useTokenizer(true);
  const lang = file ? languageFor(file.path) : null;
  const decos = useMemo(() => decorateRows(rows, lang, tokenize, { side, ignoreWhitespace: prefs.ignoreWhitespace }), [rows, lang, tokenize, side, prefs.ignoreWhitespace]);

  const threadsByRow = useMemo(() => {
    const m = new Map<string, Thread[]>();
    for (const t of lineThreads) {
      const key = `${t.anchor.side}:${t.anchor.endLine}`;
      m.set(key, [...(m.get(key) ?? []), t].sort(byId));
    }
    return m;
  }, [lineThreads]);
  const ownDropped = useMemo(() => dropped.filter((d) => d.anchor.kind !== 'review' && d.anchor.file === file?.path), [dropped, file?.path]);
  const fileTombstones = ownDropped.filter((d) => d.anchor.kind === 'file');
  const tombstones = useMemo(() => {
    const m = new Map<string, Thread[]>();
    for (const t of ownDropped.filter(onLines)) {
      const key = `${t.anchor.side}:${t.anchor.endLine}`;
      m.set(key, [...(m.get(key) ?? []), t]);
    }
    return m;
  }, [ownDropped]);
  // The file's composer is open for this path only, so another file never inherits it.
  const [composingOn, setComposingOn] = useState<string | null>(null);
  // Comment on file is in the sticky header, so the diff may be scrolled far below the block: bring the composer into view,
  // clear of the header (its height varies as it wraps).
  // Keyed on the composer being shown, so it also runs when the composer reappears (writes back on after a read-only view).
  const composingFile = !!file && composingOn === file.path && !ctx.readOnly;
  const headerRef = useRef<HTMLDivElement>(null);
  const fileComposerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = fileComposerRef.current;
    if (!el) return;
    el.style.scrollMarginTop = `${headerRef.current?.offsetHeight ?? 0}px`;
    el.scrollIntoView?.({ block: 'nearest' });
  }, [composingFile]);

  // Open context that hides any line of a thread's range, of the cited lines, or (after a Diff options change) of the selection.
  const revealKey = `${file?.path}|${file?.threads.map((t) => t.id).join()}|${route.lines}|${targetSide}|${ctx.fileDiff.total}|${prefs.context}|${prefs.ignoreWhitespace}`;
  useEffect(() => {
    if (!file) return;
    const wanted = lineThreads.map((t) => ({ side: t.anchor.side, start: t.anchor.startLine, end: t.anchor.endLine }));
    if (target) wanted.push({ side: targetSide, start: target.start, end: target.end });
    if (sel.selection) wanted.push(sel.selection);
    reveal(wanted);
  }, [revealKey]);

  // A target beyond the rendered window widens it.
  useEffect(() => {
    const wantLine = target?.start;
    const wantThread = route.thread ? lineThreads.find((t) => t.id === route.thread)?.anchor : null;
    const idx = visible.findIndex((r) => (wantLine != null && lineOn(r, targetSide) === wantLine) || (wantThread && lineOn(r, wantThread.side) === wantThread.endLine));
    if (idx >= limit) setLimit(idx + 200);
  }, [visible, route.lines, route.thread]);
  useEffect(() => { setLimit(CHUNK_ROWS); }, [file?.path]);
  useEffect(() => {
    if (!target) return;
    document.querySelector<HTMLElement>('[data-line-target]')?.scrollIntoView?.({ block: 'center' });
  }, [route.lines, visible.length]);

  if (!route.file) return <Empty title="Select a file to see its changes" />;
  if (loading && !file) return <Loading label="Loading diff" rows={8} />;
  if ((error as { code?: string } | undefined)?.code === 'FILE_NOT_IN_DIFF') return <CitedExcerpt path={route.file} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!file) return ctx.compare && route.lines ? <CitedExcerpt path={route.file} /> : <Empty title="That file isn’t in this diff" />;

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

  const settledThread = ({ thread: t, other }: ShownThread) => (
    <SettledThread
      key={t.id} thread={t} collapsed={collapse.collapsed.has(`t:${t.id}`)} toggleable={collapse.toggleable(`t:${t.id}`)} onToggle={(open) => collapse.setOpen(`t:${t.id}`, open)}
      note={ctx.compare && <CompareNote thread={t} other={other} compare={ctx.compare} />}
    />
  );

  /**
   * What renders under a row: tombstone notices, thread cards, then the selection toolbar or composer.
   * A comparison thread whose two copies fall under one row shows once, as its round-B copy.
   */
  const belowRow = (keys: string[], endsSelection: boolean) => {
    const threads = dedupeCopies(keys.flatMap((k) => threadsByRow.get(k) ?? []));
    const notices = keys.flatMap((k) => tombstones.get(k) ?? []);
    return (
      <>
        {notices.map((t) => <p key={t.id} className="px-3 py-1 font-sans text-xs text-muted-foreground">Thread {t.id} dropped: its lines changed</p>)}
        {threads.length > 0 && (
          <div className="sticky left-0 flex flex-col gap-2 px-3 py-2 font-sans text-sm">
            {threads.map(settledThread)}
          </div>
        )}
        {endsSelection && sel.selection && !sel.dragging && (
          <div className="sticky left-0 px-3 py-2 font-sans text-sm">
            {sel.composing ? (
              <Composer
                anchor={{ kind: 'lines', file: file.path, side: sel.selection.side, startLine: sel.selection.start, endLine: sel.selection.end }}
                label={selectionLabel(sel.selection)}
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
          <SplitRow pair={r} sel={sel} enabled={enabled} target={targetSel} marks={marks} decos={decos} />
          {belowRow([`old:${r.left?.old}`, `new:${r.right?.new}`], !!s && pairLine(r, s.side) === s.end)}
        </Fragment>
      );
    }
    return (
      <Fragment key={r.key}>
        <InlineRow line={r.line} sel={sel} enabled={enabled} target={targetSel} marks={marks} segs={decos.get(r.line)} />
        {belowRow(keysOf([r.line]), !!s && lineOn(r, s.side) === s.end)}
      </Fragment>
    );
  };

  return (
    <div ref={diffView.paneRef} aria-busy={switching || undefined} inert={switching || undefined} className={cn('flex min-w-0 flex-col', switching && 'opacity-60')}>
      <FileHeader
        ref={headerRef}
        file={file} files={ctx.files} onBack={onBack} extra={extra} view={textFile && diffView.available ? diffView : undefined} options={textFile}
        onComment={enabled ? () => setComposingOn(file.path) : undefined}
      />
      {(fileThreads.length > 0 || fileTombstones.length > 0 || composingFile) && (
        <section aria-label="File threads" className="flex flex-col gap-2 border-b px-3 py-2 text-sm">
          {composingFile && <div ref={fileComposerRef}><Composer anchor={{ kind: 'file', file: file.path }} label="This file" onClose={() => setComposingOn(null)} /></div>}
          {fileTombstones.map((t) => <p key={t.id} className="text-xs text-muted-foreground">Thread {t.id} dropped: its file left the diff</p>)}
          {fileThreads.map(settledThread)}
        </section>
      )}
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

const selectionLabel = (s: { side: Side; start: number; end: number }) => rangeLabel({ side: s.side, startLine: s.start, endLine: s.end });
