import { ArrowLeftIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Row } from '@/lib/diffRows';
import { formatLines, navigate, parseLines, useRoute } from '@/lib/route';
import { contains, lineOn } from '@/lib/selection';
import type { DiffFile, Side, Thread } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useDropped } from '@/state/dropped';
import { useReviewCtx } from '@/state/reviewContext';
import { Empty, ErrorState, Loading } from '@/features/common/States';
import { Composer } from '@/features/threads/Composer';
import { ThreadCard } from '@/features/threads/ThreadCard';
import { CitedExcerpt } from './CitedExcerpt';
import { FileVerdict } from './FileVerdict';
import { GapRow } from './GapRow';
import { Gutter } from './Gutter';
import { HunkBar } from './HunkBar';
import { useLineSelection } from './useLineSelection';

export const CHUNK_ROWS = 1500;
const byId = (a: Thread, b: Thread) => a.id.localeCompare(b.id, undefined, { numeric: true });

function FileHeader({ file, files, onBack, extra }: { file: DiffFile; files: { path: string }[]; onBack?: () => void; extra?: ReactNode }) {
  const i = files.findIndex((f) => f.path === file.path);
  const go = (path: string) => navigate({ file: path, lines: undefined, side: undefined, thread: undefined });
  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b bg-background px-3 py-2">
      {onBack && <Button variant="ghost" size="icon-sm" aria-label="Back to files" onClick={onBack}><ArrowLeftIcon /></Button>}
      <div className="min-w-0 flex-1 basis-24">
        <p className="truncate font-mono text-sm font-medium" title={file.path}>{file.path}</p>
        {file.oldPath && <p className="truncate font-mono text-xs text-muted-foreground">renamed from {file.oldPath}</p>}
      </div>
      <Badge variant="outline">{file.status}</Badge>
      <span className="text-xs"><span className="text-success">+{file.additions}</span> <span className="text-destructive">−{file.deletions}</span></span>
      <FileVerdict file={file} />
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
  const sel = useLineSelection(rows, textFile && !ctx.readOnly, `${ctx.id}:${file?.path}`);
  const [limit, setLimit] = useState(CHUNK_ROWS);
  const target = route.lines ? parseLines(route.lines) : null;
  const targetSide: Side = route.side ?? 'new';

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
    const idx = rows.findIndex((r) => (wantLine != null && lineOn(r, targetSide) === wantLine) || (wantThread && lineOn(r, wantThread.side) === wantThread.endLine));
    if (idx >= limit) setLimit(idx + 200);
  }, [rows, route.lines, route.thread]);
  useEffect(() => { setLimit(CHUNK_ROWS); }, [file?.path]);
  useEffect(() => {
    if (!target) return;
    document.querySelector<HTMLElement>('[data-line-target]')?.scrollIntoView?.({ block: 'center' });
  }, [route.lines, rows.length]);

  if (!route.file) return <Empty title="Select a file to see its changes" />;
  if (loading) return <Loading label="Loading diff" rows={8} />;
  if ((error as { code?: string } | undefined)?.code === 'FILE_NOT_IN_DIFF') return <CitedExcerpt path={route.file} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!file) return <Empty title="That file isn’t in this diff" />;

  const shown = rows.slice(0, limit);
  const blocks: Row[][] = [];
  for (const r of shown) {
    if (r.kind === 'hunk' || !blocks.length) blocks.push([r]);
    else blocks[blocks.length - 1].push(r);
  }
  const lastGap = [...rows].reverse().find((r) => r.kind === 'gap');
  const selectedRow = (r: Row, s: Side) => r.kind === 'line' && contains(sel.selection, s, r.line[s]);

  return (
    <div className="flex min-w-0 flex-col">
      <FileHeader file={file} files={ctx.files} onBack={onBack} extra={extra} />
      {!textFile && (
        <div className="flex flex-col gap-2 p-3">
          <p className="text-sm text-muted-foreground">{file.binary ? 'Binary file changed' : 'Too large to diff'}</p>
          {file.hunks.map((h) => <HunkBar key={h.id} hunk={h} commentable={false} />)}
        </div>
      )}
      {textFile && (
        <div ref={sel.grid} role="grid" aria-label={`Changes in ${file.path}`} aria-multiselectable className="font-mono text-xs leading-5 pointer-coarse:leading-7">
          {blocks.map((block, bi) => (
            <div key={block[0].key} role="rowgroup" className="overflow-x-auto [contain-intrinsic-size:auto_400px] [content-visibility:auto]">
              {block.map((r) => {
                if (r.kind === 'hunk') {
                  return (
                    <div key={r.key} className="sticky left-0 border-y bg-muted/50 px-3 py-1 font-sans">
                      {r.hunk.kind === 'text' && <p className="font-mono text-xs text-muted-foreground">{r.hunk.header}</p>}
                      <HunkBar hunk={r.hunk} commentable={r.hunk.kind === 'text'} />
                    </div>
                  );
                }
                if (r.kind === 'gap') {
                  return <GapRow key={r.key} row={r} first={r.gapKey === 'pre'} last={r === lastGap && r.gapKey.startsWith('after:') && bi === blocks.length - 1} readOnly={!!ctx.commit} onExpand={(how) => expand(r.gapKey, how)} />;
                }
                const { line } = r;
                const inTarget = target && contains({ side: targetSide, start: target.start, end: target.end, anchorLine: target.start }, targetSide, line[targetSide]);
                const selected = selectedRow(r, 'new') || selectedRow(r, 'old');
                const endsSelection = sel.selection && lineOn(r, sel.selection.side) === sel.selection.end;
                const keys = [`old:${line.old}`, `new:${line.new}`];
                const inline = keys.flatMap((k) => threadsByRow.get(k) ?? []);
                const notices = keys.flatMap((k) => tombstones.get(k) ?? []);
                return (
                  <Fragment key={r.key}>
                    <div
                      role="row"
                      aria-selected={selected}
                      data-line-target={inTarget && line[targetSide] === target!.start ? '' : undefined}
                      className={cn('flex w-max min-w-full', line.t === 'add' && 'bg-success/10', line.t === 'del' && 'bg-destructive/10', inTarget && 'bg-warning/20', selected && 'bg-info/20')}
                    >
                      <Gutter side="old" n={line.old} sel={sel} enabled={!ctx.readOnly} />
                      <Gutter side="new" n={line.new} sel={sel} enabled={!ctx.readOnly} />
                      <div role="gridcell" aria-hidden className="w-4 shrink-0 text-center text-muted-foreground select-none">{line.t === 'add' ? '+' : line.t === 'del' ? '−' : ' '}</div>
                      <div role="gridcell" className="pr-3 whitespace-pre">{line.text}</div>
                    </div>
                    {notices.map((t) => <p key={t.id} className="px-3 py-1 font-sans text-xs text-muted-foreground">Thread {t.id} dropped: its lines changed</p>)}
                    {inline.length > 0 && (
                      <div className="sticky left-0 flex flex-col gap-2 px-3 py-2 font-sans text-sm">
                        {inline.map((t) => <ThreadCard key={t.id} thread={t} />)}
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
                  </Fragment>
                );
              })}
            </div>
          ))}
          {rows.length > limit && (
            <div className="p-3">
              <Button variant="outline" size="sm" onClick={() => setLimit(limit + CHUNK_ROWS)}>Show next {CHUNK_ROWS} lines ({rows.length - limit} left)</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function selectionLabel(s: { side: Side; start: number; end: number }): string {
  return `L${formatLines(s.start, s.end).replace('-', '–L')} (${s.side})`;
}
