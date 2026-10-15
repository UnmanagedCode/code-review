import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeRepo, git, lines } from './_git.js';
import { resolveTarget, buildSnapshot } from '../src/snapshot.js';
import { attempt } from '../src/refusals.js';
import { isDirty, commitLog, withPrivateIndex } from '../src/git.js';

const repos = [];
afterEach(() => { while (repos.length) repos.pop().cleanup(); });
const repo = () => { const r = makeRepo(); repos.push(r); return r; };
const snapOf = async (r, kind, target) => {
  const shas = await resolveTarget(r.dir, kind, target);
  return { shas, snap: await buildSnapshot({ kind, repo: r.dir, checkout: r.dir, ...shas }) };
};
const paths = (snap) => snap.files.map((f) => f.path).sort();

test('range with a branch base excludes commits the base gained after the fork', async () => {
  const r = repo();
  r.commit({ 'a.txt': 'a\n' });
  r.branch('feat');
  r.commit({ 'feat.txt': 'f\n' });
  r.checkout('main');
  r.commit({ 'main-later.txt': 'm\n' });
  r.checkout('feat');
  const { snap } = await snapOf(r, 'range', { base: 'main' });
  assert.deepEqual(paths(snap), ['feat.txt']);
});

test('range with a sha base is fixed at that sha', async () => {
  const r = repo();
  const c1 = r.commit({ 'a.txt': 'a\n' });
  r.commit({ 'b.txt': 'b\n' });
  r.commit({ 'c.txt': 'c\n' });
  const { snap, shas } = await snapOf(r, 'range', { base: c1 });
  assert.equal(shas.baseSha, c1);
  assert.deepEqual(paths(snap), ['b.txt', 'c.txt']);
});

test('after merging an advanced base into the branch, the range shows only the branch\'s own work', async () => {
  const r = repo();
  r.commit({ 'a.txt': 'a\n' });
  r.branch('feat');
  r.commit({ 'feat.txt': 'f\n' });
  r.checkout('main');
  r.commit({ 'main-later.txt': 'm\n' });
  r.checkout('feat');
  r.git('merge', '-q', '--no-edit', 'main');
  const { snap } = await snapOf(r, 'range', { base: 'main' });
  assert.deepEqual(paths(snap), ['feat.txt']);
});

test('range without a common ancestor refuses NO_COMMON_ANCESTOR; an unknown base REF_UNKNOWN', async () => {
  const r = repo();
  r.commit({ 'a.txt': 'a\n' });
  r.git('checkout', '-q', '--orphan', 'other');
  r.commit({ 'o.txt': 'o\n' });
  assert.equal((await attempt(() => resolveTarget(r.dir, 'range', { base: 'main' }))).code, 'NO_COMMON_ANCESTOR');
  assert.equal((await attempt(() => resolveTarget(r.dir, 'range', { base: 'nope' }))).code, 'REF_UNKNOWN');
});

test('commit kind shows exactly that commit, and a root commit works', async () => {
  const r = repo();
  const root = r.commit({ 'a.txt': 'a\n' });
  r.commit({ 'b.txt': 'b\n' });
  assert.deepEqual(paths((await snapOf(r, 'commit', { sha: root })).snap), ['a.txt']);
  assert.deepEqual(paths((await snapOf(r, 'commit', {})).snap), ['b.txt']);
});

test('range or commit on a repo with no commits refuses UNBORN_HEAD', async () => {
  const r = repo();
  assert.equal((await attempt(() => resolveTarget(r.dir, 'commit', {}))).code, 'UNBORN_HEAD');
  assert.equal((await attempt(() => resolveTarget(r.dir, 'range', { base: 'main' }))).code, 'UNBORN_HEAD');
});

test('uncommitted includes staged, unstaged and untracked files and excludes ignored ones', async () => {
  const r = repo();
  r.commit({ 'tracked.txt': 'one\n', '.gitignore': 'ignored.txt\n' });
  r.write('tracked.txt', 'two\n');
  r.write('staged.txt', 's\n');
  r.git('add', 'staged.txt');
  r.write('untracked.txt', 'u\n');
  r.write('ignored.txt', 'i\n');
  const { snap } = await snapOf(r, 'uncommitted', {});
  assert.deepEqual(paths(snap), ['staged.txt', 'tracked.txt', 'untracked.txt']);
  assert.equal(snap.files.find((f) => f.path === 'untracked.txt').status, 'added');
});

test('uncommitted works on an unborn HEAD', async () => {
  const r = repo();
  r.write('x.txt', 'x\n');
  const { snap } = await snapOf(r, 'uncommitted', {});
  assert.deepEqual(paths(snap), ['x.txt']);
});

// Stat-dirty the file so that a plain `git diff HEAD` would rewrite the index.
async function assertIndexUntouched(r, checkout) {
  const real = path.resolve(checkout, git(checkout, 'rev-parse', '--git-path', 'index'));
  const future = new Date(Date.now() + 5000);
  fs.utimesSync(path.join(checkout, 'a.txt'), future, future);
  const before = fs.readFileSync(real);
  const mtime = fs.statSync(real).mtimeMs;
  const shas = await resolveTarget(checkout, 'uncommitted', {});
  const snap = await buildSnapshot({ kind: 'uncommitted', repo: checkout, checkout, ...shas });
  await Promise.all([isDirty(checkout), snap.lines('new', 'a.txt')]);
  assert.ok(before.equals(fs.readFileSync(real)));
  assert.equal(fs.statSync(real).mtimeMs, mtime);
}

test('an uncommitted snapshot leaves the main checkout\'s .git/index byte-identical', async () => {
  const r = repo();
  r.commit({ 'a.txt': 'a\n' });
  await assertIndexUntouched(r, r.dir);
});

test('an uncommitted snapshot leaves a linked worktree\'s index (under the common git dir) byte-identical', async () => {
  const r = repo();
  r.commit({ 'a.txt': 'a\n' });
  const wt = r.worktreeAdd(path.join(r.dir, '..', `${path.basename(r.dir)}-wt`), 'wt-branch');
  try {
    await assertIndexUntouched(r, fs.realpathSync(wt));
  } finally {
    fs.rmSync(wt, { recursive: true, force: true });
  }
});

test('the private index copy is never newer than the original, so git\'s racy-timestamp re-hashing still applies', async () => {
  const r = repo();
  r.commit({ 'a.txt': 'a\n' });
  const real = path.join(r.dir, '.git', 'index');
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(real, old, old);
  const copyMtime = await withPrivateIndex(r.dir, ({ env }) => fs.statSync(env.GIT_INDEX_FILE).mtimeMs);
  assert.ok(copyMtime <= fs.statSync(real).mtimeMs);
});

test('an uncommitted snapshot of a repo with no index file leaves none behind and sees staged-nothing', async () => {
  const r = repo();
  r.write('x.txt', 'x\n');
  const idx = path.join(r.dir, '.git', 'index');
  assert.equal(fs.existsSync(idx), false);
  const { snap } = await snapOf(r, 'uncommitted', {});
  assert.deepEqual(paths(snap), ['x.txt']);
  assert.equal(fs.existsSync(idx), false);
});

test('concurrent uncommitted snapshots each get their own private index', async () => {
  const r = repo();
  r.commit({ 'a.txt': 'a\n' });
  r.write('u.txt', 'u\n');
  const results = await Promise.all(Array.from({ length: 6 }, () => snapOf(r, 'uncommitted', {})));
  for (const { snap } of results) assert.deepEqual(paths(snap), ['u.txt']);
});

test('lines() reads both sides, taking a renamed file\'s old side from oldPath', async () => {
  const r = repo();
  const body = lines(30);
  r.commit({ 'old.txt': body });
  r.branch('feat');
  r.git('mv', 'old.txt', 'new.txt');
  r.write('new.txt', body.replace('l5\n', 'CHANGED\n'));
  r.commit({});
  const { snap } = await snapOf(r, 'range', { base: 'main' });
  const f = snap.files[0];
  assert.equal(f.status, 'renamed');
  assert.equal((await snap.lines('old', f.path))[4], 'l5');
  assert.equal((await snap.lines('new', f.path))[4], 'CHANGED');
  assert.equal(await snap.lines('new', 'missing.txt'), null);
});

test('uncommitted new side is read from the working tree; a symlink escaping the checkout is refused', async () => {
  const r = repo();
  r.commit({ 'a.txt': 'a\n' });
  const outside = path.join(path.dirname(r.dir), `${path.basename(r.dir)}-outside.txt`);
  fs.writeFileSync(outside, 'secret\n');
  try {
    fs.symlinkSync(outside, path.join(r.dir, 'link.txt'));
    r.write('a.txt', 'live\n');
    const { snap } = await snapOf(r, 'uncommitted', {});
    assert.deepEqual(await snap.lines('new', 'a.txt'), ['live']);
    assert.equal(await snap.lines('new', 'link.txt'), null);
  } finally {
    fs.rmSync(outside, { force: true });
  }
});

test('refs that look like options are refused BAD_REF', async () => {
  const r = repo();
  r.commit({ 'a.txt': 'a\n' });
  for (const bad of ['--output=x', '-x', 'a b', '']) {
    assert.equal((await attempt(() => resolveTarget(r.dir, 'range', { base: bad }))).code, 'BAD_REF', bad);
  }
  assert.equal((await attempt(() => resolveTarget(r.dir, 'commit', { sha: '--output=x' }))).code, 'BAD_REF');
});

test('isDirty detects uncommitted and untracked changes', async () => {
  const r = repo();
  r.commit({ 'a.txt': 'a\n' });
  assert.equal(await isDirty(r.dir), false);
  r.write('new.txt', 'n\n');
  assert.equal(await isDirty(r.dir), true);
});

test('untracked files over the size or count cap are listed tooLarge with a file-level hunk', async () => {
  const r = repo();
  r.commit({ 'a.txt': 'a\n' });
  r.write('big.txt', 'x'.repeat(50));
  r.write('s1.txt', '1\n');
  r.write('s2.txt', '2\n');
  const shas = await resolveTarget(r.dir, 'uncommitted', {});
  const snap = await buildSnapshot({ kind: 'uncommitted', repo: r.dir, checkout: r.dir, ...shas, limits: { maxFileBytes: 10, maxUntracked: 2 } });
  const by = Object.fromEntries(snap.files.map((f) => [f.path, f]));
  assert.equal(by['big.txt'].tooLarge, true);
  assert.equal(by['big.txt'].hunks[0].kind, 'file');
  assert.equal(by['s2.txt'].tooLarge, true, 'the file past the count cap');
  assert.equal(by['s1.txt'].tooLarge, undefined);
});

test('a diff above the buffer limit refuses DIFF_TOO_LARGE', async () => {
  const r = repo();
  r.commit({ 'a.txt': 'a\n' });
  r.commit({ 'b.txt': lines(200) });
  const shas = await resolveTarget(r.dir, 'commit', {});
  const res = await attempt(() => buildSnapshot({ kind: 'commit', repo: r.dir, checkout: r.dir, ...shas, limits: { maxDiffBytes: 100 } }));
  assert.equal(res.code, 'DIFF_TOO_LARGE');
});

test('a pinned sha that no longer exists refuses SNAPSHOT_GONE', async () => {
  const r = repo();
  r.commit({ 'a.txt': 'a\n' });
  const res = await attempt(() => buildSnapshot({ kind: 'commit', repo: r.dir, checkout: r.dir, baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40) }));
  assert.equal(res.code, 'SNAPSHOT_GONE');
});

test('commitLog lists newest first and flags merge commits', async () => {
  const r = repo();
  const c1 = r.commit({ 'a.txt': 'a\n' });
  r.branch('feat');
  r.commit({ 'f.txt': 'f\n' }, 'feat work');
  r.checkout('main');
  r.commit({ 'm.txt': 'm\n' });
  r.git('merge', '-q', '--no-ff', '--no-edit', 'feat');
  const log = await commitLog(r.dir, { range: `${c1}..HEAD` });
  assert.equal(log[0].merge, true);
  assert.equal(log.length, 3);
  assert.ok(log.slice(1).every((c) => !c.merge));
  assert.match(log[0].sha, /^[0-9a-f]{40}$/);
});

// Names, sizes and mtimes of everything under .git, to prove git wrote nothing there.
function gitDirSig(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      const s = fs.statSync(p);
      out.push(`${path.relative(dir, p)} ${s.size} ${s.mtimeMs}`);
    }
  };
  walk(path.join(dir, '.git'));
  return out.sort();
}

test('in a repo with core.fsmonitor=true, isDirty and range and uncommitted snapshots leave .git untouched (no daemon files)', async () => {
  const r = repo();
  r.commit({ 'a.txt': 'a\n' });
  r.branch('feat');
  r.commit({ 'b.txt': 'b\n' });
  r.write('u.txt', 'u\n');
  r.git('config', 'core.fsmonitor', 'true');
  const before = gitDirSig(r.dir);
  try {
    await isDirty(r.dir);
    await snapOf(r, 'range', { base: 'main' });
    await snapOf(r, 'uncommitted', {});
    assert.deepEqual(gitDirSig(r.dir), before);
  } finally {
    try { r.git('-c', 'core.fsmonitor=false', 'fsmonitor--daemon', 'stop'); } catch { /* none was started */ }
  }
});

test('uncommitted: a file removed from the index but unchanged on disk has no entry', async () => {
  const r = repo();
  r.commit({ 'a.txt': 'a\n', 'keep.txt': 'k\n' });
  r.git('rm', '--cached', '-q', 'a.txt');
  const { snap } = await snapOf(r, 'uncommitted', {});
  assert.deepEqual(paths(snap), []);
});

test('uncommitted: a file removed from the index and edited on disk has one "modified" entry against HEAD', async () => {
  const r = repo();
  r.commit({ 'a.txt': 'one\ntwo\n' });
  r.git('rm', '--cached', '-q', 'a.txt');
  r.write('a.txt', 'one\nTWO\n');
  const { snap } = await snapOf(r, 'uncommitted', {});
  assert.equal(snap.files.length, 1);
  assert.equal(snap.files[0].status, 'modified');
  assert.deepEqual(snap.files[0].hunks[0].lines.filter((l) => l.t !== 'ctx').map((l) => l.text), ['two', 'TWO']);
});

test('uncommitted: a path appears once even when other files are deleted, added and untracked at the same time', async () => {
  const r = repo();
  r.commit({ 'a.txt': 'a\n', 'gone.txt': 'g\n', 'b.txt': 'b\n' });
  r.git('rm', '--cached', '-q', 'a.txt');
  r.remove('gone.txt');
  r.write('new.txt', 'n\n');
  const { snap } = await snapOf(r, 'uncommitted', {});
  assert.deepEqual(paths(snap), ['gone.txt', 'new.txt']);
});
