import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeRepo, git, lines, gitDirSig, localPlace } from './_git.js';
import { fakeCc } from './_fakeCc.js';
import { resolveTarget, buildSnapshot, ARGV_BUDGET } from '../src/snapshot.js';
import { parseDiff } from '../src/diff.js';
import { attempt } from '../src/refusals.js';
import { statusOf, commitLog, removeTemp, sizes, objectsExist, DIFF_FLAGS } from '../src/git.js';

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
const snapOf = async (r, kind, target, limits) => {
  const at = localPlace(r.dir);
  if (kind === 'uncommitted') {
    const snap = await buildSnapshot({ kind, checkout: at, limits });
    return { shas: { baseSha: snap.baseSha, headSha: snap.headSha }, snap };
  }
  const shas = await resolveTarget(at, kind, target);
  return { shas, snap: await buildSnapshot({ kind, repo: at, checkout: at, ...shas, limits }) };
};
/** Exec bodies of the two uncommitted-snapshot scripts. */
const isScan = (b) => b.argv[0] === 'sh' && b.argv[2].includes('mkdir -m 700');
const isFinish = (b) => b.argv[0] === 'sh' && b.argv[2].includes('alt=$3');
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
  const snap = await buildSnapshot({ kind: 'uncommitted', checkout: at });
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
  const file = path.join(r.dir, 'a.txt');
  fs.writeFileSync(file, 'a\n');
  const older = new Date(Date.now() - 120000);
  fs.utimesSync(file, older, older);
  r.commit({});
  // Entries older than the index and unchanged on disk: the scan's diff has nothing to refresh, so it leaves the copy as made.
  const real = path.join(r.dir, '.git', 'index');
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(real, old, old);
  let copy = null;
  cc.state.execHook = (b) => {
    if (isFinish(b)) copy = fs.statSync(path.join(b.argv[5], 'index'), { bigint: true }).mtimeNs;
    return null;
  };
  await snapOf(r, 'uncommitted');
  assert.equal(copy, fs.statSync(real, { bigint: true }).mtimeNs);
});

test('the private dir is removed from the target\'s TMPDIR after a snapshot, and after its finishing call is refused', async (t) => {
  const r = repo();
  r.commit({ 'a.txt': 'a\n' });
  r.write('a.txt', 'b\n');
  const tmp = pinTmp();
  const seen = [];
  cc.state.execHook = (b) => { if (isFinish(b)) seen.push(b.argv[5]); return null; };
  assert.deepEqual(paths((await snapOf(r, 'uncommitted')).snap), ['a.txt']);
  assert.deepEqual(fs.readdirSync(tmp), []);
  cc.state.execHook = (b) => {
    if (!isFinish(b)) return null;
    seen.push(b.argv[5]);
    return { status: 502, body: { error: 'provider died', code: 'SYSTEM_UNREACHABLE' } };
  };
  assert.equal((await attempt(() => snapOf(r, 'uncommitted'))).code, 'SYSTEM_UNREACHABLE');
  assert.ok(seen.length === 2 && seen.every((p) => p.startsWith(tmp + '/cr-index-')), 'the dirs were made under the pinned TMPDIR');
  assert.deepEqual(fs.readdirSync(tmp), [], 'removed after the refused finish');
  t.mock.method(console, 'warn', () => {});
});

test('a finishing call the system refuses, whose cleanup is refused too, warns naming the leaked dir', async (t) => {
  const r = repo();
  r.commit({ 'a.txt': 'a\n' });
  const tmp = pinTmp();
  cc.state.execHook = (b) => (isFinish(b) || b.argv[0] === 'rm' ? { status: 502, body: { error: 'provider died', code: 'SYSTEM_UNREACHABLE' } } : null);
  const warn = t.mock.method(console, 'warn', () => {});
  assert.equal((await attempt(() => snapOf(r, 'uncommitted'))).code, 'SYSTEM_UNREACHABLE');
  const [leaked] = fs.readdirSync(tmp);
  assert.match(leaked, /^cr-index-[0-9a-f]{24}$/);
  assert.equal(warn.mock.callCount(), 1);
  assert.ok(warn.mock.calls[0].arguments[0].includes(path.join(tmp, leaked)));
});

test('a scan whose exec fails (EXEC_TIMEOUT) is followed by a removal of its private dir by id', async (t) => {
  const r = repo();
  r.commit({ 'a.txt': 'a\n' });
  pinTmp();
  let id = null;
  cc.state.execHook = (b) => {
    if (!isScan(b)) return null;
    id = b.argv[5];
    return { status: 504, body: { error: 'slow', code: 'EXEC_TIMEOUT' } };
  };
  t.mock.method(console, 'warn', () => {});
  assert.equal((await attempt(() => snapOf(r, 'uncommitted'))).code, 'GIT_TIMEOUT');
  assert.match(id, /^[0-9a-f]{24}$/);
  const removal = cc.state.execCalls.filter((b) => b.argv[0] === 'sh' && b.argv[2].includes('rm -rf -- "$t/cr-index-$2"'));
  assert.deepEqual(removal.map((b) => b.argv[5]), [id]);
  assert.equal(cc.state.execCalls.filter(isFinish).length, 0);
});

test('a scan exiting with sh\'s own exit 2 is a loud Error, never CHECKOUT_GONE; a missing checkout is CHECKOUT_GONE', async (t) => {
  // Invariant: only the scripts' own path-missing code means the checkout is gone; dash's exit 2 (syntax or arithmetic error) is a plain Error.
  const r = repo();
  r.commit({ 'a.txt': 'a\n' });
  t.mock.method(console, 'warn', () => {});
  cc.state.execHook = (b) => (isScan(b) ? { status: 200, body: { exitCode: 2, stdout: '', stderr: Buffer.from('sh: 9: arithmetic expression: expecting primary').toString('base64') } } : null);
  await assert.rejects(snapOf(r, 'uncommitted'), (e) => !e.code && /arithmetic expression/.test(e.message));
  cc.state.execHook = null;
  const gone = await attempt(() => buildSnapshot({ kind: 'uncommitted', checkout: localPlace(`${r.dir}-gone`) }));
  assert.equal(gone.code, 'CHECKOUT_GONE');
  assert.equal(cc.state.execCalls.filter(isFinish).length, 0);
});

test('teardown refuses to remove a path not named cr-index-*, without running anything', async () => {
  const r = repo();
  for (const bad of [r.dir, '/tmp', 'cr-index-rel', '/tmp/cr-index-x/../y', '/tmp/not-cr-index-x', '/tmp/cr-index-', '/tmp/cr-index-x/..', '/tmp/cr-index-a/../cr-index-b']) {
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
  const { snap } = await snapOf(r, 'uncommitted', {}, { maxFileBytes: 10, maxUntracked: 2 });
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

test('untracked files are chunked by summed size: a chunk closes before it passes a third of the buffer limit', async () => {
  const r = repo();
  r.commit({ 'a.txt': 'a\n' });
  const names = ['s1.txt', 's2.txt', 's3.txt', 's4.txt', 's5.txt'];
  for (const n of names) r.write(n, `${'x'.repeat(399)}\n`); // 400 bytes each
  // Budget 3000 / 3 = 1000 bytes: two 400-byte files fit (800) and are diffed in the finishing call; the third would
  // not (1200), so it and every later one go to the batched untracked diff, chunked by the same budget.
  const { snap } = await snapOf(r, 'uncommitted', {}, { maxDiffBytes: 3000 });
  const [finish] = cc.state.execCalls.filter(isFinish);
  assert.deepEqual(finish.argv.slice(14), names, 'every untracked path went to the finishing call');
  const chunks = scriptCalls('--no-index').filter((b) => !isFinish(b)).map((b) => b.argv.slice(5));
  assert.deepEqual(chunks, [['s3.txt', 's4.txt'], ['s5.txt']]);
  assert.deepEqual(snap.files.map((f) => [f.path, f.additions]), names.map((n) => [n, 1]));
});

test('250 untracked files cost two exec calls in all, and parse the same as one diff per file', async () => {
  const r = repo();
  r.commit({ 'a.txt': 'a\n' });
  const names = Array.from({ length: 250 }, (_, i) => `u${String(i).padStart(3, '0')}.txt`);
  for (const n of names) r.write(n, `${n}\n`);
  const { snap } = await snapOf(r, 'uncommitted', {});
  assert.deepEqual(cc.state.execCalls.map((b) => (isScan(b) ? 'scan' : isFinish(b) ? 'finish' : b.argv.slice(0, 3).join(' '))), ['scan', 'finish']);
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
  // Stat-dirty a tracked file into the future, so any index refresh that is allowed to write always has something to
  // write, whatever the racy-timestamp state of the index: the outcome no longer depends on timing.
  const future = new Date(Date.now() + 5000);
  fs.utimesSync(path.join(r.dir, 'a.txt'), future, future);
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
  const { snap } = await snapOf(r, 'uncommitted', {}, { maxFileBytes: 10 });
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

test('restaging several paths adds no exec call: the snapshot is still two', async () => {
  const r = repo();
  const names = ['a', 'b', 'c', 'd'].map((n) => `${n}.txt`);
  r.commit(Object.fromEntries(names.map((n) => [n, 'one\n'])));
  r.git('rm', '--cached', '-q', ...names);
  for (const n of names) r.write(n, 'two\n');
  const { snap } = await snapOf(r, 'uncommitted', {});
  assert.equal(snap.files.length, 4);
  assert.ok(snap.files.every((f) => f.status === 'modified'));
  assert.equal(cc.state.execCalls.length, 2);
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

/** Points the fake cc's commands at `tmpdir` and returns the refusal code of an uncommitted snapshot of `dir`. */
async function snapshotWithTmp(dir, tmpdir) {
  cc.state.execEnv = { TMPDIR: tmpdir };
  return (await attempt(() => buildSnapshot({ kind: 'uncommitted', checkout: localPlace(dir) }))).code;
}

test('a relative TMPDIR is refused TEMP_UNUSABLE even when it names an existing dir outside the checkout', async () => {
  const r = repo();
  r.commit({ 'a.txt': 'a\n' });
  r.write('u.txt', 'u\n');
  const outside = path.join(path.dirname(r.dir), 'reltmp'); // `../reltmp` from inside the checkout: exists, outside it
  fs.mkdirSync(outside);
  const before = r.git('status', '--porcelain', '--untracked-files=all');
  assert.equal(await snapshotWithTmp(r.dir, '../reltmp'), 'TEMP_UNUSABLE');
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.equal(r.git('status', '--porcelain', '--untracked-files=all'), before);
  assert.equal(cc.state.execCalls.filter(isScan).length, 1, 'refused by the scan script');
  assert.equal(cc.state.execCalls.filter(isFinish).length, 0);
});

test('a relative TMPDIR naming an existing dir inside the checkout is refused, and nothing is made there', async () => {
  const r = repo();
  r.commit({ 'a.txt': 'a\n' });
  const inside = path.join(r.dir, 'reltmp');
  fs.mkdirSync(inside);
  assert.equal(await snapshotWithTmp(r.dir, 'reltmp'), 'TEMP_UNUSABLE');
  assert.deepEqual(fs.readdirSync(inside), []);
  assert.equal(fs.existsSync('/reltmp'), false, 'not resolved against cwd / either');
});

test('a TMPDIR containing a newline or a carriage return is refused TEMP_UNUSABLE before the private dir is made, and nothing is made there', async () => {
  const r = repo();
  r.commit({ 'a.txt': 'a\n' });
  for (const name of ['t\nmp', 't\rmp', 'tmp\n']) {
    const base = path.join(path.dirname(r.dir), name);
    fs.mkdirSync(base);
    assert.equal(await snapshotWithTmp(r.dir, base), 'TEMP_UNUSABLE', JSON.stringify(name));
    assert.deepEqual(fs.readdirSync(base), [], JSON.stringify(name));
  }
});

test('a failure after the private dir is made (the index cannot be copied) removes it and refuses TEMP_UNUSABLE', async () => {
  const r = repo();
  r.commit({ 'a.txt': 'a\n' });
  // An index that exists but is a directory: `cp` refuses it, deterministically and whatever the user's privileges.
  const index = path.join(r.dir, '.git', 'index');
  fs.rmSync(index);
  fs.mkdirSync(index);
  const tmp = pinTmp();
  const res = await attempt(() => buildSnapshot({ kind: 'uncommitted', checkout: localPlace(r.dir) }));
  assert.equal(res.code, 'TEMP_UNUSABLE');
  assert.match(res.reason, /copying the index failed/);
  assert.equal(cc.state.execCalls.filter(isScan).length, 1);
  assert.deepEqual(fs.readdirSync(tmp), [], 'no cr-index-* left behind');
});

test('the scan\'s printed dir is checked structurally: one whose base holds a line terminator is used and removed; any other is a refusal', async (t) => {
  const r = repo();
  r.commit({ 'a.txt': 'a\n' });
  const base = path.join(path.dirname(r.dir), 'odd\nbase\r');
  const objects = path.join(r.dir, '.git', 'objects');
  const head = r.git('rev-parse', 'HEAD');
  t.mock.method(console, 'warn', () => {});
  // Stands in for a scan that printed such a dir: only the printed path differs from a real run.
  let printed = null;
  let made = null;
  cc.state.execHook = (b) => {
    if (!isScan(b)) return null;
    made = path.join(base, `cr-index-${b.argv[5]}`);
    fs.mkdirSync(path.join(made, 'objects', 'info'), { recursive: true });
    const dir = printed ?? made;
    const out = Buffer.from(`${dir}\0${objects}\0${head}\0${0}\0${0}\0`);
    return { status: 200, body: { exitCode: 0, stdout: out.toString('base64'), stderr: '' } };
  };
  const ok = await snapOf(r, 'uncommitted');
  assert.deepEqual(ok.snap.files, []);
  assert.equal(cc.state.execCalls.filter(isFinish)[0].argv[5], made, 'the finishing call used it');
  assert.equal(fs.existsSync(made), false, 'and removed it');
  for (const bad of ['', 'relative/cr-index-x', '/tmp/not-ours', '/tmp/cr-index-', '/tmp/cr-index-a/../cr-index-b', '/tmp/cr-index-0123456789abcdef01234567']) {
    printed = bad;
    cc.state.execCalls = [];
    const res = await attempt(() => snapOf(r, 'uncommitted'));
    assert.equal(res.code, 'TEMP_UNUSABLE', JSON.stringify(bad));
    assert.equal(cc.state.execCalls.filter(isFinish).length, 0, JSON.stringify(bad));
  }
  fs.rmSync(base, { recursive: true, force: true });
});

test('untracked paths past the argument budget are measured and diffed by the batched helpers, in order, with the same result', async () => {
  const r = repo();
  r.commit({ 'a.txt': 'a\n' });
  const names = Array.from({ length: 1100 }, (_, i) => `${String(i).padStart(4, '0')}-${'n'.repeat(240)}.txt`);
  names.push(`${'z'.repeat(240)}-big.txt`);
  for (const n of names.slice(0, -1)) r.write(n, `${n.slice(0, 4)}\n`);
  r.write(names.at(-1), 'x'.repeat(50));
  const { snap } = await snapOf(r, 'uncommitted', {}, { maxUntracked: 2000, maxFileBytes: 20 });
  const [finish] = cc.state.execCalls.filter(isFinish);
  const passed = finish.argv.length - 14;
  assert.ok(passed > 0 && passed < names.length, `${passed} paths in the finishing call`);
  assert.ok(finish.argv.slice(14).join('').length <= ARGV_BUDGET);
  assert.equal(scriptCalls('ls -ldn').filter((b) => !isFinish(b)).length > 0, true, 'the rest were measured');
  const perFile = names.slice(0, -1).map((n) => {
    try { return execFileSync('git', ['-C', r.dir, ...DIFF_FLAGS, '--no-index', '--', '/dev/null', n], { encoding: 'utf8' }); } catch (e) { return e.stdout; }
  }).join('');
  assert.deepEqual(snap.files.slice(0, -1), parseDiff(perFile));
  assert.deepEqual([snap.files.at(-1).path, snap.files.at(-1).tooLarge], [names.at(-1), true]);
});

test('a TMPDIR that resolves inside the checkout, its .git, or onto the checkout itself is refused, and nothing is made there', async () => {
  const r = repo();
  r.commit({ 'a.txt': 'a\n' });
  const sub = path.join(r.dir, 'sub');
  const inGit = path.join(r.dir, '.git', 'tmp');
  fs.mkdirSync(sub);
  fs.mkdirSync(inGit);
  const link = path.join(path.dirname(r.dir), 'link-to-sub'); // outside the checkout, but resolving into it
  fs.symlinkSync(sub, link);
  for (const tmp of [sub, inGit, r.dir, link]) {
    assert.equal(await snapshotWithTmp(r.dir, tmp), 'TEMP_UNUSABLE', tmp);
  }
  assert.deepEqual(fs.readdirSync(sub), []);
  assert.deepEqual(fs.readdirSync(inGit), []);
  assert.equal(fs.readdirSync(r.dir).some((n) => n.startsWith('cr-index-')), false);
});

test('a linked worktree refuses a TMPDIR inside the common git dir it shares with the main checkout', async () => {
  const r = repo();
  r.commit({ 'a.txt': 'a\n' });
  const wt = fs.realpathSync(r.worktreeAdd(path.join(path.dirname(r.dir), 'wt'), 'wt-branch'));
  const inCommon = path.join(r.dir, '.git', 'tmp');
  fs.mkdirSync(inCommon);
  assert.equal(await snapshotWithTmp(wt, inCommon), 'TEMP_UNUSABLE');
  assert.deepEqual(fs.readdirSync(inCommon), []);
});

test('a TMPDIR that does not exist is refused TEMP_UNUSABLE; an absolute one outside the checkout works', async () => {
  const r = repo();
  r.commit({ 'a.txt': 'a\n' });
  r.write('a.txt', 'b\n');
  assert.equal(await snapshotWithTmp(r.dir, path.join(path.dirname(r.dir), 'missing')), 'TEMP_UNUSABLE');
  const ok = path.join(path.dirname(r.dir), 'tmp-ok');
  fs.mkdirSync(ok);
  assert.equal(await snapshotWithTmp(r.dir, ok), undefined);
  assert.deepEqual(fs.readdirSync(ok), []);
});

test('the committed-snapshot cache is per place: one virtual path on two systems is diffed on each', async () => {
  // Two repos with identical commits (pinned identity and dates make the shas equal); only system b's marks a.txt
  // binary through .git/info/attributes, which is not part of any commit.
  const [a, b] = [repo(), repo()];
  for (const x of [a, b]) {
    x.commit({ 'a.txt': 'one\n' });
    x.branch('feat');
    x.commit({ 'a.txt': 'two\n' });
  }
  assert.equal(a.git('rev-parse', 'HEAD'), b.git('rev-parse', 'HEAD'));
  fs.writeFileSync(path.join(b.dir, '.git', 'info', 'attributes'), 'a.txt binary\n');
  const root = `/cr-remote-${path.basename(path.dirname(a.dir))}`;
  cc.state.systems = { sa: { root, dir: path.dirname(a.dir) }, sb: { root, dir: path.dirname(b.dir) } };
  try {
    const files = async (system) => {
      const at = { system, remoteId: null, path: `${root}/repo` };
      const shas = await resolveTarget(at, 'range', { base: 'main' });
      return (await buildSnapshot({ kind: 'range', repo: at, checkout: at, ...shas })).files.map((f) => [f.path, f.binary]);
    };
    assert.deepEqual(await files('sa'), [['a.txt', false]]);
    assert.deepEqual(await files('sb'), [['a.txt', true]]);
  } finally {
    cc.state.systems = {};
  }
});
