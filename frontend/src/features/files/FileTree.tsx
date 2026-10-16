import { CircleIcon, FileIcon } from 'lucide-react';
import { RouteLink } from '@/components/RouteLink';
import { cn } from '@/lib/utils';
import { buildTree, type TreeNode } from '@/lib/fileTree';
import type { FileState } from '@/lib/types';

const STATUS: Record<FileState['status'], string> = { added: 'A', deleted: 'D', modified: 'M', renamed: 'R' };

function FileMeta({ f }: { f: FileState }) {
  const v = f.verdicts;
  const t = f.threads;
  return (
    <span className="flex basis-full flex-wrap items-center gap-x-3 pl-5 text-xs text-muted-foreground">
      <span><span className="text-success">+{f.additions}</span> <span className="text-destructive">−{f.deletions}</span></span>
      {v ? <span>{v.accepted} accepted, {v.rejected} rejected, {v.pending} pending</span> : <span>{f.hunks} {f.hunks === 1 ? 'hunk' : 'hunks'}</span>}
      {t.open + t.resolved + t.outdated > 0 && <span>{t.open} open, {t.resolved} resolved, {t.outdated} outdated</span>}
      {f.unread > 0 && <CircleIcon className="size-2 fill-info text-info" role="img" aria-label={`${f.unread} unread`} />}
    </span>
  );
}

function Node({ node, depth, selected }: { node: TreeNode; depth: number; selected: string | undefined }) {
  const pad = { paddingLeft: `${0.75 + depth * 0.875}rem` };
  if (!node.file) {
    return (
      <li>
        <div className="py-1 pr-3 text-xs font-medium text-muted-foreground" style={pad}>{node.name}/</div>
        <ul>{node.children.map((c) => <Node key={c.path + (c.file ? '' : '/')} node={c} depth={depth + 1} selected={selected} />)}</ul>
      </li>
    );
  }
  const f = node.file;
  return (
    <li>
      <RouteLink
        to={{ file: f.path, lines: undefined, side: undefined, thread: undefined, view: undefined }}
        aria-current={selected === f.path ? 'true' : undefined}
        title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
        className={cn('flex min-h-9 flex-wrap items-center gap-x-2 py-1 pr-3 text-sm hover:bg-accent', selected === f.path && 'bg-accent')}
        style={pad}
      >
        <FileIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="font-mono text-xs text-muted-foreground" aria-label={f.status}>{STATUS[f.status]}</span>
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
        <FileMeta f={f} />
      </RouteLink>
    </li>
  );
}

export function FileTree({ files, selected }: { files: FileState[]; selected: string | undefined }) {
  const tree = buildTree(files);
  return (
    <nav aria-label="Files">
      <ul>{tree.children.map((c) => <Node key={c.path + (c.file ? '' : '/')} node={c} depth={0} selected={selected} />)}</ul>
    </nav>
  );
}
