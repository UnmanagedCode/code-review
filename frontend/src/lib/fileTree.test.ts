import { expect, test } from 'vitest';
import { fileState } from '@/test/fixtures';
import { buildTree } from './fileTree';

test('files nest by directory, directories first, with totals rolled up', () => {
  const tree = buildTree([
    fileState({ path: 'src/b.ts', additions: 3, deletions: 1, unread: 1, threads: { open: 2, resolved: 0, outdated: 0 } }),
    fileState({ path: 'README.md', additions: 1, deletions: 0 }),
    fileState({ path: 'src/lib/c.ts', additions: 5, deletions: 5, threads: { open: 1, resolved: 1, outdated: 1 } }),
  ]);
  expect(tree.children.map((c) => c.name)).toEqual(['src', 'README.md']);
  const src = tree.children[0];
  expect(src.children.map((c) => c.name)).toEqual(['lib', 'b.ts']);
  expect(src.totals).toMatchObject({ files: 2, additions: 8, deletions: 6, open: 3, resolved: 1, outdated: 1, unread: 1 });
  expect(tree.totals.files).toBe(3);
  expect(src.children[1].file?.path).toBe('src/b.ts');
});
