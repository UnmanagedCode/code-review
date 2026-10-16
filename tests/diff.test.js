import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDiff } from '../src/diff.js';

const Z = '0'.repeat(40);
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

const modify = (p, body, hdr = '@@ -1,3 +1,3 @@') =>
  `diff --git a/${p} b/${p}\nindex ${A}..${B} 100644\n--- a/${p}\n+++ b/${p}\n${hdr}\n${body}`;

test('line numbers are correct for context, add and delete lines', () => {
  const [f] = parseDiff(modify('x.js', ' keep\n-gone\n+new1\n+new2\n tail\n', '@@ -4,3 +4,4 @@ fn()'));
  const h = f.hunks[0];
  assert.equal(h.header, '@@ -4,3 +4,4 @@ fn()');
  assert.deepEqual(h.lines.map((l) => [l.t, l.old, l.new]), [
    ['ctx', 4, 4], ['del', 5, null], ['add', null, 5], ['add', null, 6], ['ctx', 6, 7],
  ]);
  assert.equal(f.additions, 2);
  assert.equal(f.deletions, 1);
  assert.equal(f.status, 'modified');
});

test('"\\ No newline" marks the previous line and creates no line of its own', () => {
  const [f] = parseDiff(modify('x.js', '-old\n\\ No newline at end of file\n+new\n', '@@ -1 +1 @@'));
  const lines = f.hunks[0].lines;
  assert.equal(lines.length, 2);
  assert.equal(lines[0].noEol, true);
  assert.equal(lines[1].noEol, undefined);
});

test('a rename with edits is "renamed" and carries oldPath', () => {
  const text = `diff --git a/old.js b/new.js\nsimilarity index 80%\nrename from old.js\nrename to new.js\nindex ${A}..${B} 100644\n--- a/old.js\n+++ b/new.js\n@@ -1 +1 @@\n-a\n+b\n`;
  const [f] = parseDiff(text);
  assert.equal(f.status, 'renamed');
  assert.equal(f.path, 'new.js');
  assert.equal(f.oldPath, 'old.js');
  assert.equal(f.hunks[0].kind, 'text');
});

test('a pure rename, a binary file and a mode-only change each yield exactly one file-level hunk', () => {
  const rename = `diff --git a/o.js b/n.js\nsimilarity index 100%\nrename from o.js\nrename to n.js\n`;
  const binary = `diff --git a/i.png b/i.png\nindex ${A}..${B} 100644\nBinary files a/i.png and b/i.png differ\n`;
  const mode = `diff --git a/s.sh b/s.sh\nold mode 100644\nnew mode 100755\n`;
  const files = parseDiff(rename + binary + mode);
  assert.equal(files.length, 3);
  for (const f of files) {
    assert.equal(f.hunks.length, 1);
    assert.equal(f.hunks[0].kind, 'file');
    assert.deepEqual(f.hunks[0].lines, []);
  }
  assert.equal(files[1].binary, true);
  assert.equal(files[2].oldMode, '100644');
  assert.equal(files[2].newMode, '100755');
});

test('an empty added file and an empty deleted file each get a file-level hunk with the right status', () => {
  const add = `diff --git a/e b/e\nnew file mode 100644\nindex ${Z}..e69de29bb2d1d6434b8b29ae775ad8c2e48c5391\n`;
  const del = `diff --git a/d b/d\ndeleted file mode 100644\nindex e69de29bb2d1d6434b8b29ae775ad8c2e48c5391..${Z}\n`;
  const [a, d] = parseDiff(add + del);
  assert.equal(a.status, 'added');
  assert.equal(d.status, 'deleted');
  assert.equal(a.hunks[0].kind, 'file');
  assert.notEqual(a.hunks[0].id, d.hunks[0].id);
});

test('C-quoted paths (space, tab, octal-escaped utf-8) are decoded', () => {
  const text = `diff --git "a/a b\\tc.js" "b/a b\\tc.js"\nindex ${A}..${B} 100644\n--- "a/a b\\tc.js"\n+++ "b/a b\\tc.js"\n@@ -1 +1 @@\n-x\n+y\n`
    + `diff --git "a/caf\\303\\251.txt" "b/caf\\303\\251.txt"\nindex ${A}..${B} 100644\nBinary files "a/caf\\303\\251.txt" and "b/caf\\303\\251.txt" differ\n`;
  const [f, g] = parseDiff(text);
  assert.equal(f.path, 'a b\tc.js');
  assert.equal(g.path, 'café.txt');
});

test('a binary file whose name contains a space keeps its full path', () => {
  const text = `diff --git a/my pic.png b/my pic.png\nindex ${A}..${B} 100644\nBinary files a/my pic.png and b/my pic.png differ\n`;
  assert.equal(parseDiff(text)[0].path, 'my pic.png');
});

const idOf = (text) => parseDiff(text)[0].hunks[0].id;

test('a hunk id survives a line shift', () => {
  const a = idOf(modify('x.js', ' c\n-old\n+new\n d\n', '@@ -10,3 +10,3 @@'));
  const b = idOf(modify('x.js', ' c\n-old\n+new\n d\n', '@@ -25,3 +27,3 @@'));
  assert.equal(a, b);
});

test('a hunk id survives a context-only change', () => {
  const a = idOf(modify('x.js', ' c1\n-old\n+new\n d1\n'));
  const b = idOf(modify('x.js', ' c2\n-old\n+new\n d2\n'));
  assert.equal(a, b);
});

test('a hunk id changes when its +/- lines change', () => {
  const a = idOf(modify('x.js', ' c\n-old\n+new\n d\n'));
  const b = idOf(modify('x.js', ' c\n-old\n+newer\n d\n'));
  assert.notEqual(a, b);
});

test('a hunk id changes with the path (a rename resets verdicts)', () => {
  const a = idOf(modify('x.js', '-old\n+new\n'));
  const b = idOf(modify('y.js', '-old\n+new\n'));
  assert.notEqual(a, b);
});

test('identical blocks in one file get distinct ids, stable by occurrence', () => {
  const body = '-old\n+new\n';
  const text = `diff --git a/x.js b/x.js\nindex ${A}..${B} 100644\n--- a/x.js\n+++ b/x.js\n@@ -1 +1 @@\n${body}@@ -20 +20 @@\n${body}`;
  const [f] = parseDiff(text);
  assert.notEqual(f.hunks[0].id, f.hunks[1].id);
  assert.equal(parseDiff(text)[0].hunks[1].id, f.hunks[1].id);
});

test('a new file with content is "added" with old=null line numbers', () => {
  const text = `diff --git a/n.js b/n.js\nnew file mode 100644\nindex ${Z}..${B}\n--- /dev/null\n+++ b/n.js\n@@ -0,0 +1,2 @@\n+a\n+b\n`;
  const [f] = parseDiff(text);
  assert.equal(f.status, 'added');
  assert.equal(f.oldPath, null);
  assert.deepEqual(f.hunks[0].lines.map((l) => [l.old, l.new]), [[null, 1], [null, 2]]);
});

const fileHunkId = (text) => parseDiff(text)[0].hunks[0].id;
const binary = (oldB, newB, extra = '') => `diff --git a/i.png b/i.png\n${extra}index ${oldB}..${newB} 100644\nBinary files a/i.png and b/i.png differ\n`;

test('a binary file edited at a fixed path gets a new file-level hunk id', () => {
  assert.notEqual(fileHunkId(binary(A, B)), fileHunkId(binary(A, 'c'.repeat(40))));
  assert.notEqual(fileHunkId(binary(A, B)), fileHunkId(binary('c'.repeat(40), B)));
  assert.equal(fileHunkId(binary(A, B)), fileHunkId(binary(A, B)));
});

test('a status or mode change at a fixed path changes the file-level hunk id', () => {
  const plain = fileHunkId(binary(A, B));
  assert.notEqual(plain, fileHunkId(`diff --git a/i.png b/i.png\nnew file mode 100644\nindex ${A}..${B}\nBinary files /dev/null and b/i.png differ\n`));
  assert.notEqual(fileHunkId(`diff --git a/s.sh b/s.sh\nold mode 100644\nnew mode 100755\n`), fileHunkId(`diff --git a/s.sh b/s.sh\nold mode 100644\nnew mode 100700\n`));
  assert.notEqual(fileHunkId(`diff --git a/o.js b/n.js\nrename from o.js\nrename to n.js\n`), fileHunkId(`diff --git a/p.js b/n.js\nrename from p.js\nrename to n.js\n`));
});

test('the file-level hunk id depends on status even when blobs, modes and paths are equal', () => {
  const added = `diff --git a/i.png b/i.png\nnew file mode 100644\nindex ${A}..${B} 100644\nBinary files /dev/null and b/i.png differ\n`;
  const modified = `diff --git a/i.png b/i.png\nindex ${A}..${B} 100644\nBinary files a/i.png and b/i.png differ\n`;
  const [a, m] = [parseDiff(added)[0], parseDiff(modified)[0]];
  assert.deepEqual([a.oldMode, a.newMode, a.oldBlob, a.newBlob, a.oldPath], [m.oldMode, m.newMode, m.oldBlob, m.newBlob, m.oldPath]);
  assert.notEqual(a.status, m.status);
  assert.notEqual(a.hunks[0].id, m.hunks[0].id);
});
