import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeRepo, git, lines, gitDirSig, localPlace } from './_git.js';
import { fakeCc } from './_fakeCc.js';
import { resolveTarget, buildSnapshot } from '../src/snapshot.js';
import { parseDiff } from '../src/diff.js';
import { attempt } from '../src/refusals.js';
import { statusOf, commitLog, withPrivateIndex, removeTemp, sizes, objectsExist, DIFF_FLAGS } from '../src/git.js';

let cc;
before(async () => { cc = await fakeCc(); });
after(() => cc.close());
const repos = [];
afterEach(() => {
  while (repos.length) repos.pop().cleanup();
  cc.state.execCalls = [];
  cc.state.execHook = null;
  cc.state.execEnv = {};
});
const repo = () => { const r = makeRepo(); repos.push(r); return r; };
const snapOf = async (r, kind, target) => {
  const at = localPlace(r.dir);
  const shas = await resolveTarget(at, kind, target);
  return { shas, snap: await buildSnapshot({ kind, repo: at, checkout: at, ...shas }) };
};
/** Exec bodies whose sh script contains `marker`. */
const scriptCalls = (marker) => cc.state.execCalls.filter((b) => b.argv[0] === 'sh' && b.argv[2].includes(marker));
/** A fresh dir the fake cc's commands use as TMPDIR, so private index dirs can be counted. */
const pinTmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-tmp-'));
  repos.push({ cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) });
  cc.state.execEnv = { TMPDIR: dir };
  return dir;
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
  assert.equal((await attempt(() => resolveTarget(localPlace(r.dir), 'range', { base: 'main' }))).code, 'NO_COMMON_ANCESTOR');
  assert.equal((await attempt(() => resolveTarget(localPlace(r.dir), 'range', { base: 'nope' }))).code, 'REF_UNKNOWN');
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
  assert.equal((await attempt(() => resolveTarget(localPlace(r.dir), 'commit', {}))).code, 'UNBORN_HEAD');
  assert.equal((await attempt(() => resolveTarget(localPlace(r.dir), 'range', { base: 'main' }))).code, 'UNBORN_HEAD');
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
  const at = localPlace(checkout);
  const shas = await resolveTarget(at, 'uncommitted', {});
  const snap = await buildSnapshot({ kind: 'uncommitted', repo: at, checkout: at, ...shas });
  await Promise.all([statusOf(at), snap.lines('new', 'a.txt')]);
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
  const wt = r.worktreeAdd(path.join(path.dirname(r.dir), 'wt'), 'wt-branch');
  await assertIndexUntouched(r, fs.realpathSync(wt));
});

test('the private index copy carries the original\'s exact mtime, so git\'s racy-timestamp decisions are the original\'s own', async () => {
  const r = repo();
  r.commit({ 'a.txt': 'a\n' });
  const real = path.join(r.dir, '.git', 'index');
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(real, old, old);
  const copy = await withPrivateIndex(localPlace(r.dir), ({ env }) => fs.statSync(env.GIT_INDEX_FILE, { bigint: true }).mtimeNs);
  assert.equal(copy, fs.statSync(real, { bigint: true }).mtimeNs);
});

test('the private index dir is removed from the target\'s TMPDIR after success and after the callback throws', async () => {
  const r = repo();
  r.commit({ 'a.txt': 'a\n' });
  const tmp = pinTmp();
  const seen = [];
  assert.equal(await withPrivateIndex(localPlace(r.dir), ({ env }) => { seen.push(env.GIT_INDEX_FILE); return 'done'; }), 'done');
  await assert.rejects(withPrivateIndex(localPlace(r.dir), ({ env }) => { seen.push(env.GIT_INDEX_FILE); throw new Error('boom'); }), /boom/);
  assert.ok(seen.every((p) => p.startsWith(tmp + '/cr-index-')), 'the dirs were made under the pinned TMPDIR');
  assert.deepEqual(fs.readdirSync(tmp), []);
});

test('a teardown the system refuses returns the callback\'s result and warns, naming the leaked dir', async (t) => {
  const r = repo();
  r.commit({ 'a.txt': 'a\n' });
  const tmp = pinTmp();
  cc.state.execHook = (b) => (b.argv[0] === 'rm' ? { status: 502, body: { error: 'provider died', code: 'SYSTEM_UNREACHABLE' } } : null);
  const warn = t.mock.method(console, 'warn', () => {});
  assert.equal(await withPrivateIndex(localPlace(r.dir), () => 42), 42);
  const [leaked] = fs.readdirSync(tmp);
  assert.match(leaked, /^cr-index-/);
  assert.equal(warn.mock.callCount(), 1);
  assert.ok(warn.mock.calls[0].arguments[0].includes(path.join(tmp, leaked)));
});

test('teardown refuses to remove a path not named cr-index-*, without running anything', async () => {
  const r = repo();
  for (const bad of [r.dir, '/tmp', 'cr-index-rel', '/tmp/cr-index-x/../y', '/tmp/not-cr-index-x']) {
    await assert.rejects(removeTemp(localPlace(r.dir), bad), /refusing to remove/, bad);
  }
  assert.equal(cc.state.execCalls.length, 0);
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
  const outside = path.join(path.dirname(r.dir), 'outside.txt'); // in the repo's own temp dir
  fs.writeFileSync(outside, 'secret\n');
  fs.symlinkSync(outside, path.join(r.dir, 'link.txt'));
  r.write('a.txt', 'live\n');
  const { snap } = await snapOf(r, 'uncommitted', {});
  assert.deepEqual(await snap.lines('new', 'a.txt'), ['live']);
  assert.equal(await snap.lines('new', 'link.txt'), null);
});

test('refs that look like options are refused BAD_REF', async () => {
  const r = repo();
  r.commit({ 'a.txt': 'a\n' });
  for (const bad of ['--output=x', '-x', 'a b', '']) {
    assert.equal((await attempt(() => resolveTarget(localPlace(r.dir), 'range', { base: bad }))).code, 'BAD_REF', bad);
  }
  assert.equal((await attempt(() => resolveTarget(localPlace(r.dir), 'commit', { sha: '--output=x' }))).code, 'BAD_REF');
});

test('statusOf reports dirty for uncommitted and untracked changes', async () => {
  const r = repo();
  r.commit({ 'a.txt': 'a\n' });
  assert.equal((await statusOf(localPlace(r.dir))).dirty, false);
  r.write('new.txt', 'n\n');
  assert.equal((await statusOf(localPlace(r.dir))).dirty, true);
});

test('untracked files over the size or count cap are listed tooLarge with a file-level hunk', async () => {
  const r = repo();
  r.commit({ 'a.txt': 'a\n' });
  r.write('big.txt', 'x'.repeat(50));
  r.write('s1.txt', '1\n');
  r.write('s2.txt', '2\n');
  const shas = await resolveTarget(localPlace(r.dir), 'uncommitted', {});
  const snap = await buildSnapshot({ kind: 'uncommitted', repo: localPlace(r.dir), checkout: localPlace(r.dir), ...shas, limits: { maxFileBytes: 10, maxUntracked: 2 } });
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
  const shas = await resolveTarget(localPlace(r.dir), 'commit', {});
  const res = await attempt(() => buildSnapshot({ kind: 'commit', repo: localPlace(r.dir), checkout: localPlace(r.dir), ...shas, limits: { maxDiffBytes: 100 } }));
  assert.equal(res.code, 'DIFF_TOO_LARGE');
});

test('a pinned sha that no longer exists refuses SNAPSHOT_GONE naming it, from one object check for both shas', async () => {
  const r = repo();
  const sha = r.commit({ 'a.txt': 'a\n' });
  const at = localPlace(r.dir);
  const res = await attempt(() => buildSnapshot({ kind: 'commit', repo: at, checkout: at, baseSha: sha, headSha: 'b'.repeat(40) }));
  assert.equal(res.code, 'SNAPSHOT_GONE');
  assert.match(res.reason, /bbbbbbbb/);
  assert.equal(scriptCalls('cat-file -e').length, 1);
  assert.equal(await objectsExist(at, [sha, sha]), null);
  assert.equal(await objectsExist(at, ['c'.repeat(40), sha, 'd'.repeat(40)]), 'c'.repeat(40), 'the first missing one');
});

test('sizes reports lstat sizes in argument order: a symlink its own size, a vanished path null, a newline in a name kept apart', async () => {
  const r = repo();
  r.write('big.txt', 'x'.repeat(1000));
  r.write('a\nb.txt', 'abc');
  fs.symlinkSync('big.txt', path.join(r.dir, 'link.txt'));
  assert.deepEqual(await sizes(localPlace(r.dir), ['link.txt', 'big.txt', 'gone.txt', 'a\nb.txt', '-dash']), [7, 1000, null, 3, null]);
  assert.deepEqual(await sizes(localPlace(r.dir), []), []);
});

test('250 untracked files cost three diff calls and two size calls, and parse the same as one diff per file', async () => {
  const r = repo();
  r.commit({ 'a.txt': 'a\n' });
  const names = Array.from({ length: 250 }, (_, i) => `u${String(i).padStart(3, '0')}.txt`);
  for (const n of names) r.write(n, `${n}\n`);
  const { snap } = await snapOf(r, 'uncommitted', {});
  assert.equal(scriptCalls('--no-index').length, 3);
  assert.equal(scriptCalls('ls -ldn').length, 2);
  const perFile = names.map((n) => {
    try { return execFileSync('git', ['-C', r.dir, ...DIFF_FLAGS, '--no-index', '--', '/dev/null', n], { encoding: 'utf8' }); } catch (e) { return e.stdout; }
  }).join('');
  assert.deepEqual(snap.files, parseDiff(perFile));
});

test('commitLog lists newest first and flags merge commits', async () => {
  const r = repo();
  const c1 = r.commit({ 'a.txt': 'a\n' });
  r.branch('feat');
  r.commit({ 'f.txt': 'f\n' }, 'feat work');
  r.checkout('main');
  r.commit({ 'm.txt': 'm\n' });
  r.git('merge', '-q', '--no-ff', '--no-edit', 'feat');
  const log = await commitLog(localPlace(r.dir), { range: `${c1}..HEAD` });
  assert.equal(log[0].merge, true);
  assert.equal(log.length, 3);
  assert.ok(log.slice(1).every((c) => !c.merge));
  assert.match(log[0].sha, /^[0-9a-f]{40}$/);
});

// Names, sizes and mtimes of everything under .git, to prove git wrote nothing there.
test('in a repo with core.fsmonitor=true, statusOf and range and uncommitted snapshots leave .git untouched (no daemon files)', async () => {
  const r = repo();
  r.commit({ 'a.txt': 'a\n' });
  r.branch('feat');
  r.commit({ 'b.txt': 'b\n' });
  r.write('u.txt', 'u\n');
  r.git('config', 'core.fsmonitor', 'true');
  const before = gitDirSig(r.dir);
  try {
    await statusOf(localPlace(r.dir));
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
  const before = gitDirSig(r.dir);
  const { snap } = await snapOf(r, 'uncommitted', {});
  assert.deepEqual(gitDirSig(r.dir), before, 'neither the index nor the object store of the real .git was written');
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

test('restaging an untracked-then-edited path writes no object into the real object store, and the diff shows the working-tree content', async () => {
  const r = repo();
  r.commit({ 'a.txt': 'one\n' });
  r.git('rm', '--cached', '-q', 'a.txt');
  r.write('a.txt', 'unique-working-tree-content\n');
  const before = gitDirSig(r.dir);
  const { snap } = await snapOf(r, 'uncommitted', {});
  assert.deepEqual(gitDirSig(r.dir), before);
  assert.ok(snap.files[0].hunks[0].lines.some((l) => l.text === 'unique-working-tree-content'));
});

test('uncommitted: a restaged path over the size cap is tooLarge with a file-level hunk, not a full diff', async () => {
  const r = repo();
  r.commit({ 'a.txt': 'x'.repeat(50) + '\n' });
  r.git('rm', '--cached', '-q', 'a.txt');
  r.write('a.txt', 'y'.repeat(60) + '\n');
  const shas = await resolveTarget(localPlace(r.dir), 'uncommitted', {});
  const snap = await buildSnapshot({ kind: 'uncommitted', repo: localPlace(r.dir), checkout: localPlace(r.dir), ...shas, limits: { maxFileBytes: 10 } });
  assert.equal(snap.files.length, 1);
  assert.equal(snap.files[0].tooLarge, true);
  assert.equal(snap.files[0].status, 'modified');
  assert.equal(snap.files[0].hunks[0].kind, 'file');
});

test('uncommitted: a restaged path git cannot read degrades to a tooLarge entry instead of failing the snapshot', { skip: process.getuid?.() === 0 }, async () => {
  const r = repo();
  r.commit({ 'a.txt': 'one\n', 'b.txt': 'b\n' });
  r.git('rm', '--cached', '-q', 'a.txt');
  fs.chmodSync(path.join(r.dir, 'a.txt'), 0o000);
  try {
    const { snap } = await snapOf(r, 'uncommitted', {});
    assert.deepEqual(paths(snap), ['a.txt']);
    assert.equal(snap.files[0].tooLarge, true);
  } finally {
    fs.chmodSync(path.join(r.dir, 'a.txt'), 0o644);
  }
});

test('an uncommitted snapshot works in a checkout whose path contains a colon, restaged paths included', async () => {
  const r = makeRepo({ dirName: 'co:lon' });
  repos.push(r);
  r.commit({ 'a.txt': 'one\n', 'b.txt': 'b\n' });
  r.git('rm', '--cached', '-q', 'a.txt');
  r.write('a.txt', 'edited\n');
  r.write('new.txt', 'n\n');
  assert.ok(r.dir.includes(':'));
  const { snap } = await snapOf(r, 'uncommitted', {});
  assert.deepEqual(paths(snap), ['a.txt', 'new.txt']);
  assert.equal(snap.files.find((f) => f.path === 'a.txt').status, 'modified');
});

test('a failing batch restage falls back to per-path staging: good paths still diff, the bad one becomes tooLarge', async () => {
  const r = repo();
  r.commit({ 'a-bad.txt': 'bad\n', 'b-good.txt': 'one\n', 'c-good.txt': 'one\n' });
  r.git('rm', '--cached', '-q', 'a-bad.txt', 'b-good.txt', 'c-good.txt');
  r.git('config', 'filter.boom.clean', 'false');
  r.git('config', 'filter.boom.required', 'true');
  r.write('.gitattributes', 'a-bad.txt filter=boom\n');
  r.write('a-bad.txt', 'bad edited\n');
  r.write('b-good.txt', 'two\n');
  r.write('c-good.txt', 'three\n');
  const { snap } = await snapOf(r, 'uncommitted', {});
  const by = Object.fromEntries(snap.files.map((f) => [f.path, f]));
  assert.equal(by['a-bad.txt'].tooLarge, true);
  assert.equal(by['b-good.txt'].status, 'modified');
  assert.ok(by['b-good.txt'].hunks[0].lines.some((l) => l.text === 'two'));
  assert.ok(by['c-good.txt'].hunks[0].lines.some((l) => l.text === 'three'));
});

test('a restage batch of several paths is one exec call, not one per path', async () => {
  const r = repo();
  const names = ['a', 'b', 'c', 'd'].map((n) => `${n}.txt`);
  r.commit(Object.fromEntries(names.map((n) => [n, 'one\n'])));
  r.git('rm', '--cached', '-q', ...names);
  for (const n of names) r.write(n, 'two\n');
  const { snap } = await snapOf(r, 'uncommitted', {});
  assert.equal(snap.files.length, 4);
  assert.equal(cc.state.execCalls.filter((b) => b.argv.includes('update-index')).length, 1);
});

test('an uncommitted snapshot works in a checkout whose path contains a newline, a quote, a backslash, a leading # or non-ASCII', async () => {
  for (const dirName of ['new\nline', 'q"u\\o', '#hash', 'café']) {
    const r = makeRepo({ dirName });
    repos.push(r);
    r.commit({ 'a.txt': 'one\n' });
    r.write('a.txt', 'two\n');
    const { snap } = await snapOf(r, 'uncommitted', {});
    assert.deepEqual(paths(snap), ['a.txt'], JSON.stringify(dirName));
    assert.ok(snap.files[0].hunks[0].lines.some((l) => l.t === 'del' && l.text === 'one'), 'HEAD objects resolved through the alternates entry');
  }
});
