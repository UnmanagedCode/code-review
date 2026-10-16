import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeRepo, lines } from './_git.js';
import { resolveTarget, buildSnapshot, isBinaryFile } from '../src/snapshot.js';
import { parseCitations, resolveCitation, citationsForMessage, MAX_EXCERPT_LINES } from '../src/citations.js';

const fakeSnap = (files) => ({ lines: async (_side, p) => files[p] ?? null });
const body = (n) => Array.from({ length: n }, (_, i) => `l${i + 1}`);

test('parses path#Lx-Ly and path#Lx, ordering reversed ranges', () => {
  assert.deepEqual(parseCitations('see a/b.js#L10-L20 and x.js#L5, also y.js#L9-L3'), [
    { raw: 'a/b.js#L10-L20', path: 'a/b.js', startLine: 10, endLine: 20 },
    { raw: 'x.js#L5', path: 'x.js', startLine: 5, endLine: 5 },
    { raw: 'y.js#L9-L3', path: 'y.js', startLine: 3, endLine: 9 },
  ]);
});

test('URLs with a fragment are not citations', () => {
  assert.deepEqual(parseCitations('https://h/x.js#L1 and http://example.com/a/b.js#L3-L4'), []);
});

test('an excerpt is clamped to the file length; a start past the end is unresolved', async () => {
  const snap = fakeSnap({ 'a.js': body(10) });
  const r = await resolveCitation({ path: 'a.js', startLine: 8, endLine: 50 }, snap);
  assert.deepEqual(r.lines.map((l) => l.n), [8, 9, 10]);
  assert.equal(r.endLine, 10);
  assert.ok((await resolveCitation({ path: 'a.js', startLine: 11, endLine: 12 }, snap)).error);
  assert.ok((await resolveCitation({ path: 'nope.js', startLine: 1, endLine: 1 }, snap)).error);
});

test('an excerpt longer than the cap is truncated and says so', async () => {
  const snap = fakeSnap({ 'a.js': body(200) });
  const r = await resolveCitation({ path: 'a.js', startLine: 1, endLine: 200 }, snap);
  assert.equal(r.lines.length, MAX_EXCERPT_LINES);
  assert.equal(r.truncated, true);
});

test('absolute and ..-escaping paths are refused', async () => {
  const snap = fakeSnap({ '/etc/passwd': ['x'], '../x.js': ['x'] });
  assert.ok((await resolveCitation({ path: '/etc/passwd', startLine: 1, endLine: 1 }, snap)).error);
  assert.ok((await resolveCitation({ path: '../x.js', startLine: 1, endLine: 1 }, snap)).error);
});

test('a message\'s citations resolve at the snapshot of the round it was written in', async () => {
  const env = { snapshot: async (round) => fakeSnap({ 'a.js': round === 1 ? ['old-one'] : ['new-one'] }) };
  const [c] = await citationsForMessage(env, { body: 'a.js#L1', round: 1 });
  assert.equal(c.lines[0].text, 'old-one');
  const [d] = await citationsForMessage(env, { body: 'a.js#L1', round: 2 });
  assert.equal(d.lines[0].text, 'new-one');
});

test('a gone snapshot degrades to unresolved citations instead of failing', async () => {
  const env = { snapshot: async () => { throw Object.assign(new Error('x'), { code: 'SNAPSHOT_GONE' }); } };
  const [c] = await citationsForMessage(env, { body: 'a.js#L1', round: 1 });
  assert.match(c.error, /SNAPSHOT_GONE/);
});

let repo;
afterEach(() => repo?.cleanup());

test('an uncommitted symlink escaping the checkout is unresolved, a normal file resolves', async () => {
  repo = makeRepo();
  repo.commit({ 'a.js': lines(3) });
  const outside = path.join(path.dirname(repo.dir), 'secret.txt'); // in the repo's own temp dir
  fs.writeFileSync(outside, 'secret\n');
  fs.symlinkSync(outside, path.join(repo.dir, 'link.js'));
  const shas = await resolveTarget(repo.dir, 'uncommitted', {});
  const snap = await buildSnapshot({ kind: 'uncommitted', repo: repo.dir, checkout: repo.dir, ...shas });
  assert.ok((await resolveCitation({ path: 'link.js', startLine: 1, endLine: 1 }, snap)).error);
  assert.equal((await resolveCitation({ path: 'a.js', startLine: 1, endLine: 1 }, snap)).lines[0].text, 'l1');
});

test('a citation into a file the snapshot flags binary is unresolved, even without NUL bytes', async () => {
  repo = makeRepo();
  repo.commit({ 'a.js': lines(3) });
  repo.branch('feat');
  repo.commit({ '.gitattributes': '*.bin -diff\n', 'x.bin': 'plain text\n' });
  const shas = await resolveTarget(repo.dir, 'range', { base: 'main' });
  const snap = await buildSnapshot({ kind: 'range', repo: repo.dir, checkout: repo.dir, ...shas });
  assert.ok((await resolveCitation({ path: 'x.bin', startLine: 1, endLine: 1 }, snap)).error);
  assert.equal((await resolveCitation({ path: 'a.js', startLine: 1, endLine: 1 }, snap)).lines[0].text, 'l1');
});

async function rangeSnap(commitOnMain, commitOnBranch) {
  repo = makeRepo();
  repo.commit(commitOnMain);
  repo.branch('feat');
  repo.commit(commitOnBranch);
  const shas = await resolveTarget(repo.dir, 'range', { base: 'main' });
  return buildSnapshot({ kind: 'range', repo: repo.dir, checkout: repo.dir, ...shas });
}

test('a citation to a NUL-containing file outside the diff is unresolved', async () => {
  const snap = await rangeSnap({ 'logo.png': Buffer.from([0, 27, 91, 0, 255, 10]) }, { 'f.js': 'x\n' });
  assert.ok(!snap.files.some((f) => f.path === 'logo.png'));
  assert.ok((await resolveCitation({ path: 'logo.png', startLine: 1, endLine: 1 }, snap)).error);
});

test('a citation to an ordinary text file outside the diff resolves', async () => {
  const snap = await rangeSnap({ 'b.js': lines(5, 'b') }, { 'f.js': 'x\n' });
  assert.equal((await resolveCitation({ path: 'b.js', startLine: 2, endLine: 3 }, snap)).lines.map((l) => l.text).join(), 'b2,b3');
});

test('a citation into a tooLarge file is unresolved', async () => {
  repo = makeRepo();
  repo.commit({ 'a.js': lines(3) });
  repo.write('big.txt', 'plain text that is over the cap\n');
  const shas = await resolveTarget(repo.dir, 'uncommitted', {});
  const snap = await buildSnapshot({ kind: 'uncommitted', repo: repo.dir, checkout: repo.dir, ...shas, limits: { maxFileBytes: 5 } });
  assert.equal(snap.files.find((f) => f.path === 'big.txt').tooLarge, true);
  assert.ok((await resolveCitation({ path: 'big.txt', startLine: 1, endLine: 1 }, snap)).error);
});

test('a binary or tooLarge file in the diff is refused without reading its content; one outside the diff is read once for the NUL scan', async () => {
  let reads = 0;
  const files = [{ path: 'a.png', binary: true, hunks: [] }, { path: 'big.txt', tooLarge: true, hunks: [] }];
  const snap = { files, lines: async () => { reads++; return ['text']; } };
  assert.ok((await resolveCitation({ path: 'a.png', startLine: 1, endLine: 1 }, snap)).error);
  assert.ok((await resolveCitation({ path: 'big.txt', startLine: 1, endLine: 1 }, snap)).error);
  assert.equal(reads, 0);
  assert.equal((await resolveCitation({ path: 'other.txt', startLine: 1, endLine: 1 }, snap)).lines[0].text, 'text');
  assert.equal(reads, 1);
});

test('isBinaryFile decides from the snapshot flag first and only reads for a file outside the diff', async () => {
  let reads = 0;
  const read = async () => { reads++; return ['a\0b']; };
  const snap = { files: [{ path: 'in.txt', binary: false, hunks: [] }, { path: 'in.bin', binary: true, hunks: [] }] };
  assert.equal(await isBinaryFile(snap, 'in.txt', read), false, 'the flag wins over NUL bytes in the content');
  assert.equal(await isBinaryFile(snap, 'in.bin', read), true);
  assert.equal(reads, 0);
  assert.equal(await isBinaryFile(snap, 'outside.txt', read), true);
  assert.equal(reads, 1);
  assert.equal(await isBinaryFile(snap, 'gone.txt', async () => null), false, 'an absent file is not binary; the caller reports it missing');
});
