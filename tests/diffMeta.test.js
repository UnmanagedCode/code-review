// The frontend contract for dropping round trips: `lineCount` on every DiffFile, `sig` on FileStates and DiffFiles,
// `fileSig` on the writes.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { world, HUMAN, agent, editLines } from './_world.js';
import { lines } from './_git.js';
import * as reviews from '../src/reviews.js';
import * as threads from '../src/threads.js';
import * as rounds from '../src/rounds.js';
import * as compare from '../src/compare.js';
import { MAX_FILE_BYTES } from '../src/git.js';

let w;
afterEach(() => { w?.cleanup(); w = null; });

const ok = (res) => { assert.equal(res.ok, true, JSON.stringify(res).slice(0, 300)); return res; };
const by = (files) => Object.fromEntries(files.map((f) => [f.path, f]));
const sigs = (files) => Object.fromEntries(files.map((f) => [f.path, f.sig]));
const numstats = () => w.cc.state.execCalls.filter((b) => b.argv[0] === 'sh' && b.argv[2].includes('--numstat')).length;
/** A unique base commit, so no other test has cached line counts at it. */
const uniqueBase = () => w.repo.commit({ 'seed.txt': `${randomBytes(8).toString('hex')}\n` });

/** `total` of one side as GET …/file reports it, or null when the side has no lines to report (absent, binary). */
async function total(id, path, side, round) {
  const res = await reviews.fileLines(id, { path, side, ...(round ? { round } : {}) });
  if (res.ok) return res.total;
  assert.ok(['FILE_NOT_IN_DIFF', 'BINARY_FILE'].includes(res.code), `${path} ${side}: ${res.code}`);
  return null;
}

/** Every file's lineCount equals what GET …/file reports per side (an empty side, which /file cannot window, counts 0). */
async function assertCountsMatch(id, files, round) {
  for (const f of files) {
    for (const side of ['old', 'new']) {
      if (f.lineCount[side] === 0) continue;
      assert.equal(f.lineCount[side], await total(id, f.path, side, round), `${f.path} ${side}`);
    }
  }
}

test('lineCount matches GET …/file\'s total per side: modified, renamed, added, deleted, no trailing newline, CRLF, emptied; binary is null', async () => {
  // Invariant: lineCount.{old,new} is the `total` GET /reviews/:id/file reports for that side in the same view; null where the side has no text.
  w = await world();
  w.repo.commit({ 'ren.txt': lines(30, 'r'), 'del.txt': lines(4, 'd'), 'noeol.txt': 'p\nq', 'crlf.txt': 'x\r\ny\r\nz\r\n', 'm.txt': 'x\n', 'bin.dat': Buffer.from([0, 1, 2]) });
  const base = w.repo.git('rev-parse', 'HEAD');
  const wt = w.addWorktree();
  wt.git('mv', 'ren.txt', 'ren2.txt');
  wt.commit({
    'a.js': editLines({ 2: 'two' }).replace('l9\n', ''), 'ren2.txt': lines(30, 'r').replace('r4\n', 'r4!\nr4b\n'), 'del.txt': null,
    'noeol.txt': 'p\nQ\nR', 'crlf.txt': 'x\r\nY\r\n', 'm.txt': '', 'new.txt': 'n1\nn2\nn3\n', 'empty.txt': '', 'bin.dat': Buffer.from([0, 9]),
  });
  const { review } = ok(await reviews.openReview({ project: 'app', worktree: 'feature', base }, HUMAN));
  const files = ok(await reviews.diff(review.id, {})).files;
  const f = by(files);
  assert.deepEqual(f['new.txt'].lineCount, { old: null, new: 3 });
  assert.deepEqual(f['del.txt'].lineCount, { old: 4, new: null });
  assert.deepEqual(f['ren2.txt'].lineCount, { old: 30, new: 31 });
  assert.deepEqual(f['m.txt'].lineCount, { old: 1, new: 0 });
  assert.deepEqual(f['empty.txt'].lineCount, { old: null, new: 0 });
  assert.deepEqual(f['bin.dat'].lineCount, { old: null, new: null });
  assert.equal(f['a.js'].lineCount.old, 20);
  await assertCountsMatch(review.id, files);

  // A later round, the past one, and the comparison of the two.
  wt.commit({ 'a.js': editLines({ 3: 'three' }, 25), 'noeol.txt': 'p\n' });
  ok(await reviews.refreshReview(review.id, HUMAN));
  await assertCountsMatch(review.id, ok(await reviews.diff(review.id, {})).files);
  await assertCountsMatch(review.id, ok(await reviews.diff(review.id, { round: '1' })).files, '1');
  const cmp = ok(await compare.compareRounds(review.id, { from: '1', to: '2' })).files;
  assert.deepEqual(by(cmp)['a.js'].lineCount, { old: 19, new: 25 }, 'old = round 1\'s head, new = round 2\'s');
  assert.deepEqual(by(cmp)['noeol.txt'].lineCount, { old: 3, new: 1 });
});

test('lineCount on an uncommitted review counts the working tree; a tooLarge file is null', async () => {
  // Invariant: for uncommitted reviews the new side is the working tree, as GET /file reads it; tooLarge files carry no counts.
  w = await world();
  uniqueBase();
  w.repo.write('a.js', editLines({ 3: 'live' }).replace('l7\n', ''));
  w.repo.write('u.txt', 'u1\nu2\n');
  w.repo.write('huge.txt', 'h'.repeat(MAX_FILE_BYTES + 1));
  const { review } = ok(await reviews.openReview({ project: 'app', kind: 'uncommitted' }, HUMAN));
  const files = ok(await reviews.diff(review.id, {})).files;
  assert.deepEqual(by(files)['a.js'].lineCount, { old: 20, new: 19 });
  assert.deepEqual(by(files)['u.txt'].lineCount, { old: null, new: 2 });
  assert.deepEqual(by(files)['huge.txt'].lineCount, { old: null, new: null });
  await assertCountsMatch(review.id, files.filter((f) => f.path !== 'huge.txt'));
});

test('lineCount costs at most one exec the first time a base is shown, and none after', async () => {
  // Invariant: old-side counts are read in one OLD_LINE_COUNTS call per response on a miss and cached by (base sha, path).
  w = await world();
  uniqueBase();
  const wt = w.addWorktree();
  wt.commit({ 'a.js': editLines({ 2: 'x' }), 'b.js': editLines({ 2: 'y' }, 10) });
  const { review } = ok(await reviews.openReview({ project: 'app', worktree: 'feature' }, HUMAN));
  const before = numstats();
  ok(await reviews.diff(review.id, {}));
  assert.equal(numstats() - before, 1);
  ok(await reviews.diff(review.id, {}));
  ok(await reviews.diff(review.id, { file: 'a.js' }));
  assert.equal(numstats() - before, 1);
});

test('sig: stable, equal in detail and diff (and in a round view and its diff), and per file', async () => {
  // Invariant: sig is a function of what the file response shows: identical requests agree, the same file agrees across detail/diff and roundView/diff?round, and a change to one file leaves the others' sigs.
  w = await world();
  const wt = w.addWorktree();
  wt.commit({ 'a.js': editLines({ 2: 'two', 12: 'twelve' }), 'b.js': editLines({ 3: 'three' }, 10) });
  const { review } = ok(await reviews.openReview({ project: 'app', worktree: 'feature' }, HUMAN));
  const diff = async () => sigs(ok(await reviews.diff(review.id, {})).files);
  const first = await diff();
  assert.deepEqual(await diff(), first);
  assert.deepEqual(sigs(ok(await reviews.getReview(review.id)).files), first);
  for (const s of Object.values(first)) assert.match(s, /^[0-9a-f]{20}$/);

  const a = ok(await reviews.diff(review.id, { file: 'a.js' })).files[0];
  ok(await reviews.setVerdict(review.id, a.hunks[0].id, 'accepted'));
  const afterVerdict = await diff();
  assert.notEqual(afterVerdict['a.js'], first['a.js'], 'a verdict changes its file');
  assert.equal(afterVerdict['b.js'], first['b.js'], 'and only its file');
  const t = ok(await threads.annotate(review.id, HUMAN, { anchor: { kind: 'lines', file: 'b.js', side: 'new', startLine: 3 }, kind: 'comment', body: 'hm' })).thread;
  const afterThread = await diff();
  assert.notEqual(afterThread['b.js'], afterVerdict['b.js']);
  ok(await threads.reply(review.id, agent('s-agent'), t.id, { body: 'from another tab' }));
  const afterReply = await diff();
  assert.notEqual(afterReply['b.js'], afterThread['b.js'], 'a reply changes the thread, so the sig');
  ok(await threads.setThreadStatus(review.id, t.id, { status: 'resolved' }));
  const afterStatus = await diff();
  assert.notEqual(afterStatus['b.js'], afterReply['b.js']);
  assert.equal(afterStatus['a.js'], afterVerdict['a.js']);

  wt.commit({ 'b.js': editLines({ 3: 'three', 5: 'five' }, 10) });
  ok(await reviews.refreshReview(review.id, HUMAN));
  const past = ok(await rounds.roundView(review.id, '1')).files;
  assert.deepEqual(sigs(past), sigs(ok(await reviews.diff(review.id, { round: '1' })).files));
  assert.deepEqual(sigs(ok(await reviews.getReview(review.id)).files), await diff());
});

test('sig changes on an uncommitted edit that keeps the line counts, and on activity on an outdated thread of the file', async () => {
  // Invariant: the content hash covers hunk texts (and blob ids), not only counts; the FileState part covers counts and unread of every thread on the file, outdated ones included.
  w = await world();
  w.repo.write('a.js', editLines({ 3: 'first' }));
  w.repo.write('b.js', editLines({ 3: 'other' }, 10));
  const { review } = ok(await reviews.openReview({ project: 'app', kind: 'uncommitted' }, HUMAN));
  const before = sigs(ok(await reviews.diff(review.id, {})).files);
  w.repo.write('a.js', editLines({ 3: 'second' }));
  const after = ok(await reviews.diff(review.id, {})).files;
  assert.deepEqual([by(after)['a.js'].additions, by(after)['a.js'].deletions], [1, 1]);
  assert.notEqual(sigs(after)['a.js'], before['a.js']);
  assert.equal(sigs(after)['b.js'], before['b.js']);

  const wt = w.addWorktree();
  wt.commit({ 'a.js': editLines({ 2: 'two', 15: 'fifteen' }) });
  const range = ok(await reviews.openReview({ project: 'app', worktree: 'feature' }, HUMAN)).review;
  const t = ok(await threads.annotate(range.id, HUMAN, { anchor: { kind: 'lines', file: 'a.js', side: 'new', startLine: 2 }, kind: 'comment', body: 'x' })).thread;
  wt.commit({ 'a.js': editLines({ 2: 'gone-two', 15: 'fifteen' }) });
  ok(await reviews.refreshReview(range.id, HUMAN));
  const outdated = sigs(ok(await reviews.diff(range.id, {})).files)['a.js'];
  ok(await threads.reply(range.id, agent('s-agent'), t.id, { body: 'still?' }));
  assert.notEqual(sigs(ok(await reviews.diff(range.id, {})).files)['a.js'], outdated, 'the file\'s unread count changed');
});

test('each write\'s fileSig equals the sig the next diff of that file shows; a reply on a committed review costs no exec', async () => {
  // Invariant: fileSig {path, sig} on annotate, reply, thread status, verdict and accept-file is the sig GET diff?file= then returns, for committed and uncommitted reviews; a committed reply's sig comes from the cached snapshot.
  w = await world();
  const wt = w.addWorktree();
  wt.commit({ 'a.js': editLines({ 2: 'two', 12: 'twelve' }) });
  w.repo.write('b.js', editLines({ 4: 'live' }, 10));
  const range = ok(await reviews.openReview({ project: 'app', worktree: 'feature' }, HUMAN)).review;
  const unc = ok(await reviews.openReview({ project: 'app', kind: 'uncommitted' }, HUMAN)).review;
  const next = async (id, file) => ok(await reviews.diff(id, { file })).files[0].sig;
  const check = async (id, res) => {
    ok(res);
    assert.match(res.fileSig.sig, /^[0-9a-f]{20}$/);
    assert.equal(res.fileSig.sig, await next(id, res.fileSig.path), JSON.stringify(res.fileSig));
  };
  for (const [id, file, line] of [[range.id, 'a.js', 2], [unc.id, 'b.js', 4]]) {
    const made = await threads.annotate(id, HUMAN, { anchor: { kind: 'lines', file, side: 'new', startLine: line }, kind: 'question', body: 'q' });
    await check(id, made);
    await check(id, await threads.reply(id, HUMAN, made.thread.id, { body: 'r' }));
    await check(id, await threads.reply(id, agent('s-agent'), made.thread.id, { body: 'a' }));
    await check(id, await threads.setThreadStatus(id, made.thread.id, { status: 'resolved' }));
  }
  const hunks = ok(await reviews.diff(range.id, { file: 'a.js' })).files[0].hunks.map((h) => h.id);
  await check(range.id, await reviews.setVerdict(range.id, hunks[0], 'rejected'));
  await check(range.id, await reviews.acceptFile(range.id, 'a.js', hunks));

  const tid = ok(await threads.listThreads(range.id, { status: 'all' })).threads[0].id;
  const before = w.cc.state.execCalls.length;
  const res = ok(await threads.reply(range.id, HUMAN, tid, { body: 'cheap' }));
  assert.equal(w.cc.state.execCalls.length, before);
  assert.equal(res.fileSig.path, 'a.js');
});

test('a write whose file sig cannot be read still succeeds, with sig null', async () => {
  // Invariant: the sig never fails a write: an unreadable snapshot (system down) gives fileSig.sig null and the write is stored.
  w = await world();
  w.repo.write('a.js', editLines({ 4: 'live' }));
  const unc = ok(await reviews.openReview({ project: 'app', kind: 'uncommitted' }, HUMAN)).review;
  const t = ok(await threads.annotate(unc.id, HUMAN, { anchor: { kind: 'lines', file: 'a.js', side: 'new', startLine: 4 }, kind: 'comment', body: 'x' })).thread;
  w.cc.state.execHook = () => ({ status: 502, body: { error: 'down', code: 'SYSTEM_UNREACHABLE' } });
  const res = ok(await threads.reply(unc.id, HUMAN, t.id, { body: 'while down' }));
  assert.deepEqual(res.fileSig, { path: 'a.js', sig: null });
  assert.equal(res.thread.messages.length, 2);
});

test('line counts take paths literally: a name that is a glob or pathspec magic counts only itself', async () => {
  // Invariant: OLD_LINE_COUNTS runs with GIT_LITERAL_PATHSPECS=1 (merged over the base env), so `*.txt` or `:(glob)x` never matches other files.
  w = await world();
  const sha = w.repo.commit({ '*.txt': 'star\n', 'one.txt': '1\n2\n3\n', ':(glob)x': 'm\nm\n', '-dash': 'd\n' });
  const at = { system: 'local', remoteId: null, path: w.repo.dir };
  const { lineCountsAt } = await import('../src/git.js');
  w.cc.state.execCalls = [];
  const got = await lineCountsAt(at, sha, ['*.txt', ':(glob)x', '-dash', 'missing.txt']);
  assert.deepEqual([...got.entries()].sort(), [['*.txt', 1], ['-dash', 1], [':(glob)x', 2]]);
  assert.deepEqual(w.cc.state.execCalls[0].env, { LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0', GIT_LITERAL_PATHSPECS: '1' });
});
