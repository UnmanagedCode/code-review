import type { FileState } from './types';

export interface Totals { files: number; additions: number; deletions: number; open: number; resolved: number; outdated: number; unread: number; hunks: number }
export interface TreeNode { name: string; path: string; file?: FileState; children: TreeNode[]; totals: Totals }

const zero = (): Totals => ({ files: 0, additions: 0, deletions: 0, open: 0, resolved: 0, outdated: 0, unread: 0, hunks: 0 });
function add(t: Totals, f: FileState): void {
  t.files++; t.additions += f.additions; t.deletions += f.deletions; t.unread += f.unread; t.hunks += f.hunks;
  t.open += f.threads.open; t.resolved += f.threads.resolved; t.outdated += f.threads.outdated;
}

/** Nested directory tree of the files, directories first then files by name, with totals rolled up. */
export function buildTree(files: FileState[]): TreeNode {
  const root: TreeNode = { name: '', path: '', children: [], totals: zero() };
  for (const f of files) {
    const parts = f.path.split('/');
    let node = root;
    add(node.totals, f);
    parts.forEach((name, i) => {
      const path = parts.slice(0, i + 1).join('/');
      let child = node.children.find((c) => c.name === name && (i < parts.length - 1) === !c.file);
      if (!child) {
        child = { name, path, children: [], totals: zero() };
        node.children.push(child);
      }
      if (i === parts.length - 1) child.file = f;
      add(child.totals, f);
      node = child;
    });
  }
  const sort = (n: TreeNode) => {
    n.children.sort((a, b) => Number(!!a.file) - Number(!!b.file) || a.name.localeCompare(b.name));
    n.children.forEach(sort);
  };
  sort(root);
  return root;
}
