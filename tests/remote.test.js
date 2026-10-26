import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { world, HUMAN, editLines } from './_world.js';
import { gitDirSig, lines } from './_git.js';
import { tempStore } from './_store.js';
import { start } from '../server.js';
import * as reviews from '../src/reviews.js';
import * as threads from '../src/threads.js';
import * as rounds from '../src/rounds.js';
import { checkoutInfo, checkoutCommits } from '../src/checkouts.js';

// Every test here runs on a project placed on system `docker`, target `cc-box`: cc rows carry paths under a virtual
// root that does not exist on this machine, so anything not going through POST /api/exec fails.
const SYSTEM = 'docker';
const REMOTE = 'cc-box';

let w;
const cleanups = [];
afterEach(() => { w?.cleanup(); w = null; while (cleanups.length) cleanups.pop()(); });
const remoteWorld = async () => { w = await world({ system: SYSTEM, remoteId: REMOTE }); return w; };
const ok = (res) => { assert.equal(res.ok, true, JSON.stringify(res)); return res; };
const codeOf = (res) => { assert.equal(res.ok, false, `expected a refusal, got ${JSON.stringify(res).slice(0, 200)}`); return res.code; };
const assertAllRemote = () => {
  assert.ok(w.cc.state.execCalls.length > 0);
  for (const b of w.cc.state.execCalls) assert.deepEqual([b.system, b.remoteId, b.cwd], [SYSTEM, REMOTE, '/'], JSON.stringify(b.argv));
};
const pinTmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-tmp-'));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  w.cc.state.execEnv = { TMPDIR: dir };
  return dir;
};

for (const where of ['main', 'worktree']) {
  for (const kind of ['range', 'commit', 'uncommitted']) {
    test(`${where} checkout on a system, ${kind} review: open, read, annotate and pick, all over /api/exec`, async () => {
      await remoteWorld();
      const first = w.repo.git('rev-parse', 'HEAD');
      const co = where === 'main' ? w.repo : w.addWorktree();
      const worktree = where === 'main' ? null : 'feature';
      const edit = { 'a.js': editLines({ 3: 'changed-3' }), 'new.js': 'n1\nn2\n' };
      if (kind === 'uncommitted') { co.write('a.js', edit['a.js']); co.write('new.js', edit['new.js']); } else co.commit(edit);
      const head = co.git('rev-parse', 'HEAD');

      const { review } = ok(await reviews.openReview({ project: 'app', worktree, kind, ...(where === 'main' && kind === 'range' ? { base: first } : {}) }, HUMAN));
      const got = ok(await reviews.getReview(review.id));
      assert.deepEqual(got.files.map((f) => f.path).sort(), ['a.js', 'new.js']);
      assert.equal(got.review.checkoutGone, false);
      assert.equal(got.review.snapshotError, undefined);
      const [h] = ok(await reviews.getHunks(review.id, { file: 'a.js', line: 3 })).hunks;
      assert.ok(h.hunk.lines.some((l) => l.t === 'add' && l.text === 'changed-3'));
      const t = ok(await threads.annotate(review.id, HUMAN, { anchor: { file: 'a.js', side: 'new', startLine: 3 }, kind: 'comment', body: 'see new.js#L1-L2' })).thread;
      const listed = ok(await threads.listThreads(review.id, {})).threads;
      assert.deepEqual(listed.map((x) => x.id), [t.id]);
      assert.deepEqual(listed[0].messages[0].excerpts[0].lines.map((l) => l.text), ['n1', 'n2'], 'a citation is read on the system');
      assert.ok(ok(await reviews.diff(review.id, { file: 'a.js' })).files[0].threads.some((x) => x.id === t.id));
      assert.deepEqual(ok(await reviews.fileLines(review.id, { path: 'a.js', side: 'new', start: 3, end: 3 })).lines.map((l) => l.text), ['changed-3']);
      assert.deepEqual(ok(await reviews.fileLines(review.id, { path: 'a.js', side: 'old', start: 3, end: 3 })).lines.map((l) => l.text), ['l3']);
      if (kind !== 'uncommitted') assert.equal(ok(await reviews.commits(review.id)).commits[0].sha, head);

      const info = ok({ ok: true, ...(await checkoutInfo({ project: 'app', worktree })) }).checkout;
      assert.deepEqual(info, {
        project: 'app', worktree, path: w.virtual(co.dir), branch: where === 'main' ? 'main' : 'br-feature',
        headSha: head, dirty: kind === 'uncommitted', exists: true,
      });
      assert.equal((await checkoutCommits({ project: 'app', worktree }))[0].sha, head);
      assertAllRemote();
    });
  }
}

test('on a system, a refresh follows a thread across a line shift and a rename; round 1 keeps the past anchor', async () => {
  await remoteWorld();
  const wt = w.addWorktree();
  wt.commit({ 'a.js': editLines({ 2: 'top-edit', 18: 'bottom-edit' }) });
  const { review } = ok(await reviews.openReview({ project: 'app', worktree: 'feature' }, HUMAN));
  const t = ok(await threads.annotate(review.id, HUMAN, { anchor: { file: 'a.js', side: 'new', startLine: 18 }, kind: 'comment', body: 'hm' })).thread;
  wt.git('mv', 'a.js', 'c.js');
  wt.commit({ 'c.js': ['ins1', 'ins2', ...editLines({ 2: 'top-edit', 18: 'bottom-edit' }).split('\n')].join('\n') });
  const res = ok(await reviews.refreshReview(review.id, HUMAN));
  assert.equal(res.round, 2);
  assert.equal(res.threads.moved, 1);
  const now = ok(await reviews.diff(review.id, {})).files.find((f) => f.path === 'c.js').threads.find((x) => x.id === t.id);
  assert.deepEqual([now.anchor.file, now.anchor.startLine, now.anchor.round], ['c.js', 20, 2]);
  const then = ok(await reviews.diff(review.id, { round: '1' })).files.find((f) => f.path === 'a.js').threads.find((x) => x.id === t.id);
  assert.deepEqual([then.anchor.file, then.anchor.startLine], ['a.js', 18]);
  assert.equal(ok(await rounds.roundView(review.id, '1')).round.n, 1);
  assertAllRemote();
});

test('on a system, a worktree removed on the target refuses refresh CHECKOUT_GONE and stays readable through the main checkout', async () => {
  await remoteWorld();
  const wt = w.addWorktree();
  wt.commit({ 'a.js': editLines({ 2: 'top-edit' }) });
  const { review } = ok(await reviews.openReview({ project: 'app', worktree: 'feature' }, HUMAN));
  w.repo.git('worktree', 'remove', '--force', wt.dir); // cc still lists it
  assert.equal(codeOf(await reviews.refreshReview(review.id, HUMAN)), 'CHECKOUT_GONE');
  const got = ok(await reviews.getReview(review.id));
  assert.equal(got.review.checkoutGone, true);
  assert.deepEqual(got.files.map((f) => f.path), ['a.js']);
  assert.deepEqual(ok(await reviews.fileLines(review.id, { path: 'a.js', side: 'new', start: 2, end: 2 })).lines.map((l) => l.text), ['top-edit']);
  assertAllRemote();
});

for (const [ccStatus, ccCode, code] of [[502, 'SYSTEM_UNREACHABLE', 'SYSTEM_UNREACHABLE'], [504, 'EXEC_TIMEOUT', 'GIT_TIMEOUT']]) {
  test(`with the system down (${ccCode}), reviews still list and read; open and the picker refuse ${code}`, async () => {
    await remoteWorld();
    w.addWorktree().commit({ 'a.js': editLines({ 2: 'top-edit' }) });
    const range = ok(await reviews.openReview({ project: 'app', worktree: 'feature' }, HUMAN)).review;
    w.repo.write('a.js', editLines({ 5: 'live' }));
    const unc = ok(await reviews.openReview({ project: 'app', worktree: null, kind: 'uncommitted' }, HUMAN)).review;
    const t = ok(await threads.annotate(unc.id, HUMAN, { anchor: { file: 'a.js', side: 'new', startLine: 5 }, kind: 'comment', body: 'x' })).thread;
    w.cc.state.execHook = () => ({ status: ccStatus, body: { error: 'down', code: ccCode } });

    const listed = ok(await reviews.listReviews({ project: 'app' })).reviews;
    assert.deepEqual(listed.map((r) => r.id).sort(), [range.id, unc.id].sort());
    for (const r of listed) assert.deepEqual([r.snapshotError, r.checkoutGone, r.dirty], [code, false, false], r.id);
    const got = ok(await reviews.getReview(unc.id));
    assert.equal(got.review.snapshotError, code);
    const kept = ok(await threads.listThreads(unc.id, {})).threads;
    assert.deepEqual(kept.map((x) => [x.id, x.status, x.anchor.startLine]), [[t.id, 'open', 5]], 'the sweep left the thread untouched');
    assert.equal(codeOf(await reviews.diff(range.id, {})), code);
    assert.equal(codeOf(await reviews.openReview({ project: 'app', worktree: null, kind: 'commit' }, HUMAN)), code);
    assert.equal(codeOf(await reviews.refreshReview(range.id, HUMAN)), code);
    assert.equal((await reviews.listReviews({})).ok, true);
    await assert.rejects(checkoutInfo({ project: 'app', worktree: 'feature' }), (e) => e.code === code);
  });
}

for (const [ccStatus, ccCode, code] of [[502, 'SYSTEM_UNREACHABLE', 'SYSTEM_UNREACHABLE'], [504, 'EXEC_TIMEOUT', 'GIT_TIMEOUT']]) {
  test(`with only the snapshot's commands refused (${ccCode}), the existence probe still answers and reviews degrade to snapshotError ${code}`, async () => {
    await remoteWorld();
    w.addWorktree().commit({ 'a.js': editLines({ 2: 'top-edit' }) });
    const range = ok(await reviews.openReview({ project: 'app', worktree: 'feature' }, HUMAN)).review;
    w.repo.write('a.js', editLines({ 5: 'live' }));
    const unc = ok(await reviews.openReview({ project: 'app', worktree: null, kind: 'uncommitted' }, HUMAN)).review;
    const t = ok(await threads.annotate(unc.id, HUMAN, { anchor: { file: 'a.js', side: 'new', startLine: 5 }, kind: 'comment', body: 'x' })).thread;
    const probe = (b) => b.argv[0] === 'sh' && b.argv[2] === '[ -e "$1" ]';
    w.cc.state.execHook = (b) => (probe(b) ? null : { status: ccStatus, body: { error: 'down', code: ccCode } });
    w.cc.state.execCalls = [];

    const listed = ok(await reviews.listReviews({ project: 'app' })).reviews;
    assert.deepEqual(listed.map((r) => r.id).sort(), [range.id, unc.id].sort());
    for (const r of listed) assert.deepEqual([r.snapshotError, r.checkoutGone], [code, false], r.id);
    assert.ok(w.cc.state.execCalls.some(probe) && w.cc.state.execCalls.some((b) => !probe(b)), 'the probe answered and a snapshot command was refused');
    assert.equal(ok(await reviews.getReview(range.id)).review.snapshotError, code);
    assert.equal(ok(await reviews.getReview(unc.id)).review.snapshotError, code);
    assert.deepEqual(ok(await threads.listThreads(unc.id, {})).threads.map((x) => [x.id, x.status]), [[t.id, 'open']]);
    assert.equal(codeOf(await reviews.diff(range.id, {})), code);
  });
}

test('a target TMPDIR that is relative degrades reviews to snapshotError TEMP_UNUSABLE, refuses a new snapshot, and leaves the tree alone', async () => {
  await remoteWorld();
  w.repo.write('a.js', editLines({ 5: 'live' }));
  const unc = ok(await reviews.openReview({ project: 'app', worktree: null, kind: 'uncommitted' }, HUMAN)).review;
  const status = w.repo.git('status', '--porcelain', '--untracked-files=all');
  w.cc.state.execEnv = { TMPDIR: 'reltmp' };
  const [row] = ok(await reviews.listReviews({ project: 'app' })).reviews;
  assert.deepEqual([row.id, row.snapshotError, row.checkoutGone], [unc.id, 'TEMP_UNUSABLE', false]);
  ok(await threads.listThreads(unc.id, {}));
  const wt = w.addWorktree();
  wt.write('a.js', editLines({ 6: 'wt' }));
  assert.equal(codeOf(await reviews.openReview({ project: 'app', worktree: 'feature', kind: 'uncommitted' }, HUMAN)), 'TEMP_UNUSABLE');
  assert.equal(w.repo.git('status', '--porcelain', '--untracked-files=all'), status);
  assert.equal(fs.existsSync(path.join(wt.dir, 'reltmp')), false);
});

test('over HTTP: /projects lists the project on a system; /checkout describes it, and answers 502 while its system is down', async () => {
  const boot = tempStore();
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-remote-dist-'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html>');
  const server = await start({ port: 0, distDir: dist });
  cleanups.push(() => { server.closeAllConnections(); server.close(); fs.rmSync(dist, { recursive: true, force: true }); boot.cleanup(); });
  await remoteWorld();
  const get = async (url) => { const res = await fetch(`http://127.0.0.1:${server.address().port}/api${url}`); return { status: res.status, body: await res.json() }; };
  assert.deepEqual((await get('/projects')).body.projects, [{ name: 'app' }]);
  const co = await get('/checkout?project=app');
  assert.deepEqual([co.status, co.body.checkout.exists, co.body.checkout.headSha], [200, true, w.repo.git('rev-parse', 'HEAD')]);
  w.cc.state.execHook = () => ({ status: 502, body: { error: 'down', code: 'SYSTEM_UNREACHABLE' } });
  const down = await get('/checkout?project=app');
  assert.deepEqual([down.status, down.body.code], [502, 'SYSTEM_UNREACHABLE']);
});

/** Opens a range (where possible), commit and uncommitted review of one checkout and runs every read path on each. */
async function readEverything(worktree, base) {
  const ids = [];
  for (const kind of ['range', 'commit', 'uncommitted']) {
    ids.push(ok(await reviews.openReview({ project: 'app', worktree, kind, ...(kind === 'range' ? { base } : {}) }, HUMAN)).review.id);
  }
  ok(await reviews.listReviews({ project: 'app' }));
  for (const id of ids) {
    const got = ok(await reviews.getReview(id));
    assert.equal(got.review.snapshotError, undefined);
    ok(await reviews.diff(id, {}));
    ok(await reviews.fileLines(id, { path: 'b.js', side: 'old', start: 1, end: 2 }));
    ok(await threads.listThreads(id, { status: 'all' }));
    ok(await reviews.commits(id));
  }
  const unc = ok(await reviews.getReview(ids[2]));
  assert.ok(unc.files.some((f) => f.path === 'u1.txt'), 'untracked files are in the sweep');
  assert.equal(unc.files.find((f) => f.path === 'r.txt')?.status, 'modified', 'the rm --cached path was restaged');
  ok(await reviews.fileLines(ids[2], { path: 'r.txt', side: 'new' }));
  await checkoutInfo({ project: 'app', worktree });
  await checkoutCommits({ project: 'app', worktree });
}

/** A checkout with a commit, a restaged `rm --cached` path, untracked files, and a tracked file stat-dirtied into the future. */
function dirty(co) {
  co.commit({ 'r.txt': 'r1\n', 'c.txt': lines(5, 'c') });
  co.git('rm', '--cached', '-q', 'r.txt');
  co.write('r.txt', 'r2\n');
  co.write('u1.txt', 'u1\n');
  co.write('u2.txt', 'u2\n');
  const future = new Date(Date.now() + 5000);
  fs.utimesSync(path.join(co.dir, 'b.js'), future, future);
}

// git freshens (bumps the mtime of) an existing shared index on every read of a split index, as a plain `git status`
// does; that is git's own read behaviour. Only that field of a `sharedindex.*` entry is dropped: its name, content
// hash and size stay compared, so a new, removed or rewritten shared index still fails, and every other file's
// mtime stays exact.
const ignoringSharedIndexFreshen = (sigs) => sigs.map((entries) => entries.map((e) => (
  /(^|\/)sharedindex\.[0-9a-f]+ /.test(e) ? e.slice(0, e.lastIndexOf(' ')) : e)));

for (const config of [null, 'core.fsmonitor', 'core.splitIndex']) {
  for (const where of ['main', 'worktree']) {
    test(`over /api/exec on a system, every read path leaves the ${where} checkout's .git byte-identical${config ? ` with ${config}=true` : ''}`, async () => {
      await remoteWorld();
      const base = w.repo.git('rev-parse', 'HEAD');
      const co = where === 'main' ? w.repo : w.addWorktree();
      dirty(co);
      const fsmonitor = config === 'core.fsmonitor';
      if (config) w.repo.git('config', config, 'true');
      if (config === 'core.splitIndex') {
        co.git('update-index', '--split-index'); // the checkout's index is split from here on, with the rm --cached path still restageable
        assert.ok(fs.readdirSync(path.join(w.repo.dir, '.git'), { recursive: true }).some((n) => /sharedindex\./.test(n)), 'the fixture has a shared index');
      }
      const tmp = pinTmp();
      const sig = () => [gitDirSig(w.repo.dir), ...(where === 'worktree' ? [gitDirSig(co.dir)] : [])];
      const before = sig();
      if (where === 'worktree') assert.ok(before[0].some((e) => /^\.git\/worktrees\/[^/]+\/index /.test(e)), 'the common dir signature covers the worktree\'s index');
      try {
        await readEverything(where === 'main' ? null : 'feature', base);
        if (config === 'core.splitIndex') {
          const after = sig();
          assert.deepEqual(ignoringSharedIndexFreshen(after), ignoringSharedIndexFreshen(before));
          const shared = (x) => x.flat().filter((e) => /(^|\/)sharedindex\./.test(e)).map((e) => e.split(' ')[0]);
          assert.deepEqual(shared(after), shared(before), 'no shared index appeared or vanished');
        } else assert.deepEqual(sig(), before);
        assert.deepEqual(fs.readdirSync(tmp), [], 'no private index dir left behind');
        assertAllRemote();
      } finally {
        if (fsmonitor) try { w.repo.git('-c', 'core.fsmonitor=false', 'fsmonitor--daemon', 'stop'); } catch { /* none was started */ }
      }
    });
  }
}
