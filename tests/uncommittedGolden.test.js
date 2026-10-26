// Characterization of uncommitted snapshots: `files`, `fingerprint` (stored in `rounds[]` and compared by refresh),
// working-tree and base-side lines, and where an uncommitted review's threads end up after a sweep. The golden file
// was recorded from the multi-call implementation; any rewrite of the snapshot path must reproduce it byte for byte.
// Regenerate only for an intended change: UPDATE_GOLDEN=1 node --test tests/uncommittedGolden.test.js
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeRepo, lines, localPlace } from './_git.js';
import { fakeCc } from './_fakeCc.js';
import { world, HUMAN, editLines } from './_world.js';
import { buildSnapshot } from '../src/snapshot.js';
import * as reviews from '../src/reviews.js';
import * as threads from '../src/threads.js';
import * as store from '../src/store.js';

const GOLDEN = new URL('./fixtures/uncommitted.golden.json', import.meta.url);
const golden = fs.existsSync(GOLDEN) ? JSON.parse(fs.readFileSync(GOLDEN, 'utf8')) : {};
const recorded = {};
const check = (name, actual) => {
  const plain = JSON.parse(JSON.stringify(actual));
  if (process.env.UPDATE_GOLDEN) { recorded[name] = plain; return; }
  assert.ok(golden[name], `no golden entry ${name}: record it with UPDATE_GOLDEN=1`);
  assert.deepEqual(plain, golden[name]);
};
after(() => {
  if (!process.env.UPDATE_GOLDEN) return;
  fs.mkdirSync(path.dirname(GOLDEN.pathname), { recursive: true });
  fs.writeFileSync(GOLDEN, JSON.stringify({ ...golden, ...recorded }, null, 1) + '\n');
});

const cleanups = [];
afterEach(() => { while (cleanups.length) cleanups.pop()(); });

/** Every shape an uncommitted snapshot handles, in one checkout. Returns the repo and the paths to vanish mid-snapshot. */
function fixture() {
  const r = makeRepo();
  cleanups.push(() => r.cleanup());
  r.commit({
    'a.txt': lines(20),
    'del.txt': lines(5, 'd'),
    'ren-src.txt': lines(30, 'r'),
    'restage.txt': lines(6, 's'),
    'restage-big.txt': 'small\n',
    'restage-gone.txt': 'g\n',
    'bin.dat': Buffer.from([0, 1, 2, 3, 10]),
    'tracked\nnl.txt': 'one\ntwo\n',
    'crlf.txt': 'x\r\ny\r\n',
    'noeol.txt': 'p\nq',
  });
  r.write('a.txt', editLines({ 3: 'changed-3', 15: 'changed-15' }));
  r.remove('del.txt');
  r.write('staged.txt', 'staged one\nstaged two\n');
  r.git('add', 'staged.txt');
  r.git('mv', 'ren-src.txt', 'ren-dst.txt');
  r.write('ren-dst.txt', lines(30, 'r').replace('r7\n', 'r7-edited\n'));
  for (const p of ['restage.txt', 'restage-big.txt', 'restage-gone.txt']) r.git('rm', '--cached', '-q', p);
  r.write('restage.txt', lines(6, 's').replace('s2\n', 'S2\n'));
  r.write('restage-big.txt', 'B'.repeat(300) + '\n');
  r.write('bin.dat', Buffer.from([0, 9, 9, 9, 10]));
  r.write('tracked\nnl.txt', 'one\nTWO\n');
  r.write('crlf.txt', 'x\r\nY\r\n');
  r.write('noeol.txt', 'p\nQ');
  r.write('m-mid.txt', 'M'.repeat(999) + '\n');
  r.write('n-mid.txt', 'N'.repeat(999) + '\n');
  r.write('u1.txt', 'u1\n');
  r.write('u\nnl.txt', 'newline name\n');
  r.write('ubin.dat', Buffer.from([0, 0, 7]));
  r.write('v-vanish.txt', 'here, then gone\n');
  r.write('w-big.txt', 'W'.repeat(400) + '\n');
  r.write('x-past-cap.txt', 'counted out\n');
  return { r, vanish: ['restage-gone.txt', 'v-vanish.txt'] };
}

/** Deletes `paths` (relative to `dir`) when the first exec call after the untracked listing arrives. */
function vanishAfterListing(cc, dir, paths) {
  let listed = false;
  let done = false;
  cc.state.execHook = (b) => {
    if (listed && !done) {
      done = true;
      for (const p of paths) fs.rmSync(path.join(dir, p), { force: true });
    }
    if (b.argv.some((a) => a.includes('ls-files'))) listed = true;
    return null;
  };
}

/** An uncommitted snapshot of `dir` through the current snapshot API. */
async function uncommitted(dir, limits) {
  const at = localPlace(dir);
  return buildSnapshot({ kind: 'uncommitted', checkout: at, limits });
}

const SIDES = [['new', 'a.txt'], ['old', 'a.txt'], ['old', 'del.txt'], ['new', 'del.txt'], ['new', 'ren-dst.txt'], ['old', 'ren-dst.txt'],
  ['new', 'restage.txt'], ['old', 'restage.txt'], ['new', 'tracked\nnl.txt'], ['new', 'u\nnl.txt'], ['new', 'crlf.txt'], ['new', 'noeol.txt'],
  ['old', 'noeol.txt'], ['new', 'missing.txt'], ['new', 'staged.txt'], ['old', 'staged.txt']];

for (const [name, limits] of [
  // Untracked, sorted: m-mid, n-mid, u\nnl, u1, ubin, v-vanish | w-big, x-past-cap (past the count cap of 6).
  ['size caps', { maxFileBytes: 200, maxUntracked: 6 }],
  // A third of 4500 fits m-mid alone: n-mid and every later untracked file go to a second diff call.
  ['untracked budget', { maxFileBytes: 2000, maxUntracked: 6, maxDiffBytes: 4500 }],
]) {
  test(`golden uncommitted snapshot: ${name}`, async (t) => {
    const cc = await fakeCc();
    t.after(() => cc.close());
    const { r, vanish } = fixture();
    vanishAfterListing(cc, r.dir, vanish);
    const snap = await uncommitted(r.dir, limits).catch((e) => ({ refused: e.code }));
    if (snap.refused) return check(name, { refused: snap.refused });
    const sides = {};
    for (const [side, p] of SIDES) sides[`${side} ${p}`] = await snap.lines(side, p);
    check(name, { files: snap.files, fingerprint: snap.fingerprint, sides });
  });
}

test('golden uncommitted review: stored fingerprints and where the threads sit after sweeps and a refresh', async () => {
  const w = await world();
  cleanups.push(() => w.cleanup());
  w.repo.commit({ 'r.txt': lines(12, 'r'), 'gone.txt': lines(4, 'g') });
  w.repo.write('a.js', editLines({ 4: 'four', 10: 'ten' }));
  w.repo.git('mv', 'r.txt', 'r2.txt');
  w.repo.write('r2.txt', lines(12, 'r').replace('r9\n', 'r9!\n'));
  w.repo.write('gone.txt', lines(4, 'g').replace('g2\n', 'G2\n'));
  w.repo.write('u\nnl.txt', 'one\ntwo\nthree\n');
  const { review } = await reviews.openReview({ project: 'app', kind: 'uncommitted' }, HUMAN);
  const note = async (anchor) => (await threads.annotate(review.id, HUMAN, { anchor, kind: 'comment', body: 'x' })).thread.id;
  await note({ file: 'a.js', side: 'new', startLine: 10 });
  await note({ file: 'a.js', side: 'old', startLine: 4 });
  await note({ file: 'r2.txt', side: 'new', startLine: 9, endLine: 10 });
  await note({ file: 'gone.txt', side: 'new', startLine: 2 });
  await note({ file: 'u\nnl.txt', side: 'new', startLine: 2 });
  // Shift a.js down, drop gone.txt's edit (its thread is dropped), move the untracked file's line.
  w.repo.write('a.js', ['ins-1', 'ins-2', ...editLines({ 4: 'four', 10: 'ten' }).split('\n')].join('\n'));
  w.repo.git('checkout', '--', 'gone.txt');
  w.repo.write('u\nnl.txt', 'zero\none\ntwo\nthree\n');
  const got = await reviews.getReview(review.id);
  const refreshed = await reviews.refreshReview(review.id, HUMAN);
  const stored = store.read(review.id);
  const diff = await reviews.diff(review.id, {});
  check('uncommitted review', {
    fingerprints: stored.rounds.map((x) => x.fingerprint),
    refreshed,
    files: got.files.map(({ sig, ...f }) => f),
    threads: stored.threads.map((t) => ({ id: t.id, anchor: t.anchor })),
    dropped: stored.droppedThreads,
    diff: diff.files.map(({ path: p, hunks, threads: ts }) => ({ path: p, hunks, threads: ts.map((x) => [x.id, x.anchor]) })),
  });
});
