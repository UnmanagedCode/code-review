import { Fragment, useMemo, type ReactNode } from 'react';
import { RouteLink } from '@/components/RouteLink';
import { decorateRows } from '@/lib/decorate';
import { buildRows, collapseRows, type Row } from '@/lib/diffRows';
import { hunkPlace } from '@/lib/guide';
import { languageFor } from '@/lib/highlight';
import { onLines, rangeMarks } from '@/lib/ranges';
import { useRoute } from '@/lib/route';
import type { DiffFile, DiffLine, Hunk, Side, Thread } from '@/lib/types';
import type { useCollapse } from '@/features/diff/useCollapse';
import { HunkBar } from '@/features/diff/HunkBar';
import { HunkHeader } from '@/features/diff/HunkHeader';
import { InlineRow } from '@/features/diff/InlineRow';
import { SettledThread } from '@/features/diff/SettledThread';
import { useLineSelection } from '@/features/diff/useLineSelection';
import { useTokenizer } from '@/features/diff/useTokenizer';

const byId = (a: Thread, b: Thread) => a.id.localeCompare(b.id, undefined, { numeric: true });
/** The thread keys of `lines`, in line order: each line's old side, then its new side. */
const keysOf = (lines: DiffLine[]) => lines.flatMap((l) => [`old:${l.old}`, `new:${l.new}`]);

/**
 * One hunk of a guided step, drawn with the diff's own rows: inline only, no gap expansion, no line selection. Its verdict
 * bar, "Comment on hunk" and line threads work as in the file view; "Open in file" lands on the file at this hunk.
 */
export function GuideHunk({ file, hunk, collapse }: { file: DiffFile; hunk: Hunk; collapse: ReturnType<typeof useCollapse> }) {
  const route = useRoute();
  const open = (
    <div className="flex justify-end px-3 pt-1 font-sans text-xs">
      <RouteLink
        to={hunkPlace(file.path, hunk)}
        aria-label={`Open ${file.path}${hunk.kind === 'text' ? ` at ${hunk.header}` : ''}`}
        className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        Open in file
      </RouteLink>
    </div>
  );
  if (hunk.kind !== 'text') {
    return (
      <div role="group" aria-label={`Changes in ${file.path}`}>
        {open}
        <div className="flex flex-col gap-2 px-3 py-2 font-sans">
          <p className="text-sm text-muted-foreground">{file.binary ? 'Binary file changed' : 'Too large to diff'}</p>
          <HunkBar hunk={hunk} path={file.path} commentable={false} />
        </div>
      </div>
    );
  }
  return <TextHunkRows file={file} hunk={hunk} collapse={collapse} open={open} threads={route.thread} />;
}

function TextHunkRows({ file, hunk, collapse, open, threads: routed }: { file: DiffFile; hunk: Extract<Hunk, { kind: 'text' }>; collapse: ReturnType<typeof useCollapse>; open: ReactNode; threads: string | undefined }) {
  const side: Side = file.status === 'deleted' ? 'old' : 'new';
  const hid = `h:${hunk.id}`;
  const rows = useMemo(
    () => buildRows({ hunks: [hunk], expansions: {}, texts: {}, total: null, side }).filter((r) => r.kind !== 'gap'),
    [hunk, side],
  );
  const visible = useMemo(() => collapseRows(rows, (id) => collapse.collapsed.has(`h:${id}`)), [rows, collapse.collapsed]);
  const sel = useLineSelection(visible, false, `${file.path}:${hunk.id}`);
  const marks = useMemo(() => rangeMarks(file.threads, routed), [file.threads, routed]);
  const tokenize = useTokenizer(true);
  const lang = languageFor(file.path);
  const decos = useMemo(() => decorateRows(rows, lang, tokenize, { side, ignoreWhitespace: false }), [rows, lang, tokenize, side]);
  const threadsByRow = useMemo(() => {
    const m = new Map<string, Thread[]>();
    for (const t of file.threads.filter(onLines)) {
      const key = `${t.anchor.side}:${t.anchor.endLine}`;
      m.set(key, [...(m.get(key) ?? []), t].sort(byId));
    }
    return m;
  }, [file.threads]);
  const below = (keys: string[]) => {
    const threads = keys.flatMap((k) => threadsByRow.get(k) ?? []);
    if (!threads.length) return null;
    return (
      <div className="sticky left-0 flex flex-col gap-2 px-3 py-2 font-sans text-sm">
        {threads.map((t) => (
          <SettledThread key={t.id} thread={t} collapsed={collapse.collapsed.has(`t:${t.id}`)} toggleable={collapse.toggleable(`t:${t.id}`)} onToggle={(o) => collapse.setOpen(`t:${t.id}`, o)} />
        ))}
      </div>
    );
  };
  const render = (r: Row) => {
    if (r.kind === 'hunk') {
      return (
        <Fragment key={r.key}>
          <HunkHeader row={r} path={file.path} toggleable={collapse.toggleable(hid)} onToggle={(o) => collapse.setOpen(hid, o)} />
          {r.collapsed && below(keysOf(r.hunk.lines))}
        </Fragment>
      );
    }
    if (r.kind !== 'line') return null;
    return (
      <Fragment key={r.key}>
        <InlineRow line={r.line} sel={sel} enabled={false} target={null} marks={marks} segs={decos.get(r.line)} />
        {below(keysOf([r.line]))}
      </Fragment>
    );
  };
  return (
    <div>
      {open}
      <div ref={sel.grid} role="grid" aria-label={`Changes in ${file.path} ${hunk.header}`} className="overflow-x-auto font-mono text-xs leading-5 pointer-coarse:leading-7">
        <div role="rowgroup">{visible.map(render)}</div>
      </div>
    </div>
  );
}
