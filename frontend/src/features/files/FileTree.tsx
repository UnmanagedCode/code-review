import { FileIcon, MessageSquareIcon } from 'lucide-react';
import { useMemo } from 'react';
import { RouteLink } from '@/components/RouteLink';
import { cn } from '@/lib/utils';
import { buildTree, type TreeNode } from '@/lib/fileTree';
import { filterFiles, isFiltered } from '@/lib/fileFilter';
import { needsYouByFile } from '@/lib/threadState';
import type { FileState } from '@/lib/types';
import { useFileFilter } from '@/state/fileFilter';
import { useReviewCtx } from '@/state/reviewContext';
import { useReviewActions } from '@/state/threads';
import { FileTreeToolbar } from './FileTreeToolbar';
import { HunkPips } from './HunkPips';
import { StatusLetter } from './StatusLetter';

interface RowEnv { selected: string | undefined; needsYou: ReadonlyMap<string, number>; checkable: boolean; onViewed: (path: string, viewed: boolean) => void }

function Node({ node, depth, env }: { node: TreeNode; depth: number; env: RowEnv }) {
  const pad = { paddingLeft: `${0.75 + depth * 0.875}rem` };
  if (!node.file) {
    return (
      <li>
        <div className="py-1 pr-3 text-xs font-medium text-muted-foreground" style={pad}>{node.name}/</div>
        <ul>{node.children.map((c) => <Node key={c.path + (c.file ? '' : '/')} node={c} depth={depth + 1} env={env} />)}</ul>
      </li>
    );
  }
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
        title={`${f.oldPath ? `${f.oldPath} → ${f.path}` : f.path} (+${f.additions} −${f.deletions})`}
        className="flex min-w-0 flex-1 items-center gap-2 py-1 text-sm"
      >
        <FileIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <StatusLetter status={f.status} />
        <span className={cn('min-w-0 flex-1 truncate', f.viewed && 'text-muted-foreground')}>{node.name}</span>
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
 * viewed checkbox, status, name, hunk verdicts, open threads. The checkbox writes the live review's viewed mark.
 */
export function FileTree({ files, selected }: { files: FileState[]; selected: string | undefined }) {
  const { id, openThreads, readOnly, pastView, commit } = useReviewCtx();
  const actions = useReviewActions();
  const filter = useFileFilter(id);
  const needsYou = useMemo(() => needsYouByFile(openThreads), [openThreads]);
  const shown = useMemo(() => filterFiles(files, filter, needsYou), [files, filter, needsYou]);
  const tree = useMemo(() => buildTree(shown), [shown]);
  const env: RowEnv = { selected, needsYou, checkable: !readOnly, onViewed: (path, viewed) => { void actions.setViewed(path, viewed); } };
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
