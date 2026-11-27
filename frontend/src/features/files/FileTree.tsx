import { ChevronDown, ChevronRight, FileIcon, MessageSquareIcon } from 'lucide-react';
import { useId, useLayoutEffect, useMemo } from 'react';
import { RouteLink } from '@/components/RouteLink';
import { cn } from '@/lib/utils';
import { buildTree, type TreeNode } from '@/lib/fileTree';
import { filterFiles, isFiltered } from '@/lib/fileFilter';
import { needsYouByFile } from '@/lib/threadState';
import type { FileState } from '@/lib/types';
import { useFileFilter } from '@/state/fileFilter';
import { revealPath, setFolderCollapsed, useCollapsedFolders } from '@/state/treeCollapse';
import { useReviewCtx } from '@/state/reviewContext';
import { useReviewActions } from '@/state/threads';
import { FileTreeToolbar } from './FileTreeToolbar';
import { HunkPips } from './HunkPips';
import { LineCounts } from './LineCounts';
import { StatusLetter } from './StatusLetter';

/** Rows indent by depth only down to this level, so deep nesting cannot take the width the name and counts need. */
const MAX_INDENT_DEPTH = 5;
const indent = (depth: number) => ({ paddingLeft: `${0.75 + Math.min(depth, MAX_INDENT_DEPTH) * 0.875}rem` });

interface RowEnv { selected: string | undefined; needsYou: ReadonlyMap<string, number>; checkable: boolean; onViewed: (path: string, viewed: boolean) => void;
  collapsed: ReadonlySet<string>; onToggle: (dir: string) => void }

function Folder({ node, depth, env }: { node: TreeNode; depth: number; env: RowEnv }) {
  const listId = useId();
  const closed = env.collapsed.has(node.path);
  const { files, additions, deletions } = node.totals;
  return (
    <li>
      <button
        type="button" aria-expanded={!closed} aria-controls={listId} onClick={() => env.onToggle(node.path)} style={indent(depth)}
        className="flex min-h-8 w-full items-center gap-1.5 py-1 pr-3 text-left text-xs font-medium text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {closed ? <ChevronRight className="size-3.5 shrink-0" aria-hidden /> : <ChevronDown className="size-3.5 shrink-0" aria-hidden />}
        <span className="min-w-0 flex-1 truncate">{node.name}/</span>
        {closed && (
          <>
            <span className="shrink-0">{files} {files === 1 ? 'file' : 'files'}</span>
            <LineCounts additions={additions} deletions={deletions} />
          </>
        )}
      </button>
      {!closed && <ul id={listId}>{node.children.map((c) => <Node key={c.path + (c.file ? '' : '/')} node={c} depth={depth + 1} env={env} />)}</ul>}
    </li>
  );
}

function Node({ node, depth, env }: { node: TreeNode; depth: number; env: RowEnv }) {
  const pad = indent(depth);
  if (!node.file) return <Folder node={node} depth={depth} env={env} />;
  const f = node.file;
  const need = env.needsYou.get(f.path) ?? 0;
  const open = f.threads.open;
  const selected = env.selected === f.path;
  return (
    <li className={cn('flex min-h-9 items-center gap-2 pr-3 hover:bg-accent', selected && 'bg-accent')} style={pad}>
      {env.checkable && (
        <input
          type="checkbox" className="size-3.5 shrink-0 accent-primary" aria-label={`Viewed ${f.path}`} checked={f.viewed}
          onChange={(e) => env.onViewed(f.path, e.target.checked)}
        />
      )}
      <RouteLink
        to={{ file: f.path, lines: undefined, side: undefined, thread: undefined, hunk: undefined }}
        aria-current={selected ? 'true' : undefined}
        title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
        className="flex min-w-0 flex-1 items-center gap-2 py-1 text-sm"
      >
        <FileIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <StatusLetter status={f.status} />
        <span className={cn('min-w-0 flex-1 truncate', f.viewed && 'text-muted-foreground')}>{node.name}</span>
        <LineCounts additions={f.additions} deletions={f.deletions} />
        <HunkPips file={f} />
        {open > 0 && (
          <span
            role="img" aria-label={`${open} open ${open === 1 ? 'thread' : 'threads'}${need > 0 ? `, ${need} ${need === 1 ? 'needs' : 'need'} you` : ''}`}
            className={cn('inline-flex shrink-0 items-center gap-0.5 text-xs', need > 0 ? 'font-medium text-primary' : 'text-muted-foreground')}
          >
            <MessageSquareIcon className="size-3.5" aria-hidden />{open}
          </span>
        )}
      </RouteLink>
    </li>
  );
}

/**
 * The files of the open view, filtered by the toolbar and drawn in tree order (directories first, then name), one line each:
 * viewed checkbox, status, name, +/− lines, hunk verdicts, open threads. The checkbox writes the live review's viewed mark.
 * A directory row is a disclosure button; collapsed, it stands in for its files with their count and summed +/−.
 */
export function FileTree({ files, selected }: { files: FileState[]; selected: string | undefined }) {
  const { id, openThreads, readOnly, pastView, commit } = useReviewCtx();
  const actions = useReviewActions();
  const filter = useFileFilter(id);
  const needsYou = useMemo(() => needsYouByFile(openThreads), [openThreads]);
  const shown = useMemo(() => filterFiles(files, filter, needsYou), [files, filter, needsYou]);
  const tree = useMemo(() => buildTree(shown), [shown]);
  const collapsed = useCollapsedFolders(id);
  // Opening a file by any route expands its folders once; the user can collapse them again afterwards.
  useLayoutEffect(() => { if (selected) revealPath(id, selected); }, [id, selected]);
  const env: RowEnv = {
    selected, needsYou, checkable: !readOnly, onViewed: (path, viewed) => { void actions.setViewed(path, viewed); },
    collapsed, onToggle: (dir) => setFolderCollapsed(id, dir, !collapsed.has(dir)),
  };
  const live = !pastView && !commit;
  return (
    <>
      <FileTreeToolbar files={files} shown={shown.length} needsYou={needsYou} live={live} />
      <nav aria-label="Files">
        {shown.length === 0 && isFiltered(filter) ? <p className="px-3 py-2 text-sm text-muted-foreground">No files match the filter.</p>
          : <ul>{tree.children.map((c) => <Node key={c.path + (c.file ? '' : '/')} node={c} depth={0} env={env} />)}</ul>}
      </nav>
      <p className="px-3 py-2 text-xs text-muted-foreground">
        {live && !readOnly ? '☐ viewed · ' : ''}<span aria-hidden className="text-success">■</span> accepted · <span aria-hidden className="text-destructive">■</span> rejected · <span aria-hidden>□</span> undecided · <MessageSquareIcon className="inline size-3" aria-hidden /> open threads
      </p>
    </>
  );
}
