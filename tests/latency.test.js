// Call budgets: how many cc GETs and exec calls each request makes, the lookup cache and its invalidation, and the
// per-request concurrency cap.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { world, HUMAN, editLines } from './_world.js';
import { tempStore } from './_store.js';
import { start } from '../server.js';
import * as reviews from '../src/reviews.js';
import * as threads from '../src/threads.js';
import * as store from '../src/store.js';
import { checkoutInfo } from '../src/checkouts.js';
import * as git from '../src/git.js';
import { _clearLookups } from '../src/lookups.js';
import { mapLimit, ROW_CONCURRENCY } from '../src/limit.js';

let server;
let base;
let dist;
let bootStore;
let w;
before(async () => {
  bootStore = tempStore();
  dist = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-lat-dist-'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html>');
  server = await start({ port: 0, distDir: dist });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => {
  server.closeAllConnections();
  server.close();
  fs.rmSync(dist, { recursive: true, force: true });
  bootStore.cleanup();
});
afterEach(() => { w?.cleanup(); w = null; _clearLookups(); });

const ok = (res) => { assert.equal(res.ok, true, JSON.stringify(res).slice(0, 300)); return res; };
const get = async (url) => {
  const res = await fetch(base + url);
  const body = await res.json();
  assert.equal(res.status, 200, `${url}: ${JSON.stringify(body).slice(0, 300)}`);
  return body;
};
/** The cc GETs and exec calls `fn` causes: {gets: ['GET /api/…'], execs: [body]}. */
async function counted(fn) {
  const hits = w.cc.state.hits.length;
  const execs = w.cc.state.execCalls.length;
  const value = await fn();
  return { value, gets: w.cc.state.hits.slice(hits).filter((h) => h.startsWith('GET ')), execs: w.cc.state.execCalls.slice(execs) };
}
const only = (gets, route) => gets.filter((g) => g === route).length;
/** Turns on cross-request reuse for one test (the fake cc defaults it off), starting from an empty cache. */
const withTtl = (t, ms = '10000') => {
  _clearLookups();
  process.env.CODE_REVIEW_LOOKUP_TTL_MS = ms;
  t.after(() => { process.env.CODE_REVIEW_LOOKUP_TTL_MS = '0'; });
};

/** A world with a range review on worktree `feature`, a commit review and an uncommitted review on the main checkout. */
async function reviewed() {
  w = await world();
  const first = w.repo.git('rev-parse', 'HEAD');
  w.addWorktree().commit({ 'a.js': editLines({ 2: 'top-edit' }) });
  const range = ok(await reviews.openReview({ project: 'app', worktree: 'feature' }, HUMAN)).review;
  w.repo.commit({ 'b.js': editLines({ 3: 'b3' }, 10) });
  const commit = ok(await reviews.openReview({ project: 'app', kind: 'commit' }, HUMAN)).review;
  w.repo.write('a.js', editLines({ 5: 'live' }));
  const uncommitted = ok(await reviews.openReview({ project: 'app', kind: 'uncommitted' }, HUMAN)).review;
  return { first, range, commit, uncommitted };
}

test('no request a review page makes asks cc for its whole project list', async () => {
  // Invariant: /reviews, /reviews/:id, /diff, /inbox and /checkout never call GET /api/projects (the slow, fan-out route).
  const { range, commit, uncommitted } = await reviewed();
  const { gets } = await counted(async () => {
    await get('/reviews?project=app');
    for (const r of [range, commit, uncommitted]) {
      await get(`/reviews/${r.id}`);
      await get(`/reviews/${r.id}/diff`);
    }
    await get('/inbox');
    await get('/checkout?project=app&worktree=feature');
    await get('/checkout?project=app');
  });
  assert.ok(gets.length > 0);
  assert.equal(only(gets, 'GET /api/projects'), 0, gets.join(', '));
});

test('one request shares its lookups: a 5-row list over one project and worktree asks location and worktrees once each', async () => {
  // Invariant: within one request each lookup key is fetched at most once, whatever the number of rows.
  w = await world();
  w.addWorktree().commit({ 'a.js': editLines({ 2: 'x' }) });
  for (let i = 0; i < 5; i++) {
    const { review } = ok(await reviews.openReview({ project: 'app', worktree: 'feature' }, HUMAN));
    ok(await reviews.patchReview(review.id, { status: 'closed' }));
  }
  const { value, gets } = await counted(() => reviews.listReviews({ project: 'app' }));
  assert.equal(ok(value).reviews.length, 5);
  assert.deepEqual(gets.sort(), ['GET /api/projects/app/location', 'GET /api/projects/app/worktrees']);
});

test('within the TTL a second request asks cc nothing; with CODE_REVIEW_LOOKUP_TTL_MS=0 it asks again', async (t) => {
  // Invariant: positive lookups are reused across requests for the TTL, and the env var turns reuse off.
  await reviewed();
  withTtl(t);
  const first = await counted(() => reviews.listReviews({ project: 'app' }));
  assert.deepEqual(first.gets.sort(), ['GET /api/projects/app/location', 'GET /api/projects/app/worktrees']);
  assert.deepEqual((await counted(() => reviews.listReviews({ project: 'app' }))).gets, []);
  process.env.CODE_REVIEW_LOOKUP_TTL_MS = '0';
  assert.deepEqual((await counted(() => reviews.listReviews({ project: 'app' }))).gets.sort(), first.gets.sort());
});

test('a worktree added after its project\'s rows were cached resolves on the first try, re-asking cc once', async (t) => {
  // Invariant: a cached answer that says "unknown worktree" is re-asked once, bypassing the cache, before CHECKOUT_UNKNOWN.
  await reviewed();
  withTtl(t);
  ok(await reviews.listReviews({ project: 'app' }));
  w.addWorktree('later').commit({ 'b.js': 'later\n' });
  const { value, gets } = await counted(() => reviews.openReview({ project: 'app', worktree: 'later' }, HUMAN));
  assert.equal(ok(value).review.worktree, 'later');
  assert.equal(only(gets, 'GET /api/projects/app/worktrees'), 1);
  assert.equal(only(gets, 'GET /api/projects/app/location'), 0, 'the project row was still fresh');
});

test('a checkout git finds missing evicts its project\'s cached lookups, so the next request asks cc again', async (t) => {
  // Invariant: a contradiction from git (path missing) drops the cached location and worktree rows.
  const { range } = await reviewed();
  withTtl(t);
  ok(await reviews.getReview(range.id));
  assert.deepEqual((await counted(() => reviews.getReview(range.id))).gets, [], 'cached');
  w.repo.git('worktree', 'remove', '--force', path.join(path.dirname(w.repo.dir), 'wt-feature')); // cc still lists it
  const gone = await counted(() => reviews.getReview(range.id));
  assert.equal(ok(gone.value).review.checkoutGone, true);
  const next = await counted(() => reviews.getReview(range.id));
  assert.deepEqual(next.gets.sort(), ['GET /api/projects/app/location', 'GET /api/projects/app/worktrees']);
});

test('location answers: an unknown project is PROJECT_UNKNOWN; a 404 without that code is CONDUCTOR_UNAVAILABLE', async () => {
  // Invariant: only 404 + code PROJECT_UNKNOWN means "no such project"; any other answer of the location route is a cc failure.
  const { range } = await reviewed();
  assert.equal((await reviews.openReview({ project: 'nope', kind: 'uncommitted' }, HUMAN)).code, 'PROJECT_UNKNOWN');
  await assert.rejects(checkoutInfo({ project: 'nope', worktree: null }), (e) => e.code === 'PROJECT_UNKNOWN');
  w.cc.state.getHook = (p) => (p.endsWith('/location') ? { status: 404, body: { error: 'Not found' } } : null);
  assert.equal((await reviews.getReview(range.id)).code, 'CONDUCTOR_UNAVAILABLE');
  assert.equal((await reviews.openReview({ project: 'app', kind: 'uncommitted' }, HUMAN)).code, 'CONDUCTOR_UNAVAILABLE');
});

test('a committed review\'s detail costs one exec with its snapshot cached and two without', async () => {
  // Invariant: one PROBE answers existence, the round's objects and git status; only a snapshot-cache miss adds the diff.
  const { range, commit } = await reviewed();
  for (const r of [range, commit]) {
    const hit = await counted(() => reviews.getReview(r.id));
    assert.equal(ok(hit.value).review.snapshotError, undefined);
    assert.equal(hit.execs.length, 1, r.kind);
    assert.equal((await counted(() => reviews.diff(r.id, {}))).execs.length, 1, r.kind);
  }
  // A round whose snapshot this process never built (another process recorded it).
  const parent = w.repo.git('rev-parse', 'HEAD');
  const head = w.repo.commit({ 'c.js': 'c\n' });
  await store.mutate(commit.id, (rv) => { rv.rounds[0] = { ...rv.rounds[0], baseSha: parent, headSha: head }; });
  const miss = await counted(() => reviews.getReview(commit.id));
  assert.ok(ok(miss.value).files.some((f) => f.path === 'c.js'), 'the new round was diffed');
  assert.equal(miss.execs.length, 2);
});

test('an uncommitted review\'s detail, summary and diff cost exactly two execs, with or without threads', async () => {
  // Invariant: an uncommitted snapshot is SCAN + FINISH; the threads' lines the sweep needs come back in FINISH, so the sweep reads nothing more.
  const { uncommitted } = await reviewed();
  w.repo.write('n.txt', 'one\ntwo\n');
  const budget = async () => {
    for (const run of [() => reviews.getReview(uncommitted.id), () => reviews.diff(uncommitted.id, {}), () => reviews.summaryById(uncommitted.id)]) {
      const { value, execs } = await counted(run);
      ok(value);
      assert.equal(execs.length, 2, execs.map((b) => b.argv[2]?.slice(0, 40) ?? b.argv[0]).join(' | '));
    }
  };
  ok(await reviews.diff(uncommitted.id, {})); // reads a.js's line count at HEAD once; tests/diffMeta.test.js pins that cost
  await budget();
  for (const anchor of [{ kind: 'lines', file: 'a.js', side: 'new', startLine: 5 }, { kind: 'lines', file: 'a.js', side: 'old', startLine: 5 }, { kind: 'lines', file: 'n.txt', side: 'new', startLine: 2 }]) {
    ok(await threads.annotate(uncommitted.id, HUMAN, { anchor, kind: 'comment', body: 'x' }));
  }
  w.repo.write('a.js', ['top', ...editLines({ 5: 'live' }).split('\n')].join('\n')); // the sweep moves the new-side thread
  await budget();
  const stored = store.read(uncommitted.id).threads.map((t) => [t.anchor.side, t.anchor.startLine]);
  assert.deepEqual(stored, [['new', 6], ['old', 5], ['new', 2]]);
});

test('/checkout costs one exec, one location and one worktrees lookup', async () => {
  // Invariant: checkoutInfo reads existence and status in one PROBE and shares its lookups across checkout, fork points and worktrees.
  await reviewed();
  const { value, gets, execs } = await counted(() => get('/checkout?project=app&worktree=feature'));
  assert.deepEqual([value.checkout.exists, value.checkout.branch, value.forkPoints.length], [true, 'br-feature', 1]);
  assert.equal(execs.length, 1);
  assert.deepEqual(gets.sort(), ['GET /api/projects/app/location', 'GET /api/projects/app/worktrees']);
});

test('git.probe: where the checkout or its main one is, the first missing sha, and status only in the checkout', async () => {
  // Invariant: PROBE prefers the checkout, falls back to mainPath, answers null for neither (no error), names the first missing sha, and reads status only when asked and in the checkout.
  w = await world();
  const wt = w.addWorktree();
  wt.write('a.js', 'dirty\n');
  const at = { system: 'local', remoteId: null, path: wt.dir };
  const head = wt.git('rev-parse', 'HEAD');
  const gone = 'f'.repeat(40);
  assert.deepEqual(await git.probe(at, { path: wt.dir, mainPath: w.repo.dir, status: true, shas: [head, gone, 'e'.repeat(40)] }),
    { where: 'checkout', missing: gone, status: { head, branch: 'br-feature', dirty: true } });
  assert.deepEqual(await git.probe(at, { path: wt.dir, shas: [head] }), { where: 'checkout', missing: null, status: null });
  assert.deepEqual(await git.probe(at, { path: `${wt.dir}-gone`, mainPath: w.repo.dir, status: true, shas: [head] }), { where: 'main', missing: null, status: null });
  assert.deepEqual(await git.probe(at, { path: '', mainPath: '', status: true, shas: [head] }), { where: null, missing: null, status: null });
  assert.deepEqual(await git.probe(at, { path: `${wt.dir}-gone`, mainPath: `${w.repo.dir}-gone` }), { where: null, missing: null, status: null });
});

test('a probe that fails with sh\'s own exit 2 is a loud error, never "checkout gone"', async () => {
  // Invariant: only PROBE's own path-missing code means where:null; dash's exit 2 (syntax or arithmetic error, stderr written) is a plain Error, and a summary then fails rather than report checkoutGone.
  const { range } = await reviewed();
  const dash = { status: 200, body: { exitCode: 2, stdout: '', stderr: Buffer.from('sh: 1: arithmetic expression: expecting primary').toString('base64') } };
  w.cc.state.execHook = (b) => (b.argv[0] === 'sh' && b.argv[2].includes('w=checkout') ? dash : null);
  const at = { system: 'local', remoteId: null, path: w.repo.dir };
  await assert.rejects(git.probe(at, { path: w.repo.dir }), (e) => !e.code && /arithmetic expression/.test(e.message));
  await assert.rejects(reviews.getReview(range.id), /arithmetic expression/);
});

test('on a target where git cannot be found, every review still lists, degraded to snapshotError GIT_UNAVAILABLE, never gone', async () => {
  // Invariant: a missing git degrades summaries exactly as cc's EXEC_SPAWN_FAILED did (GIT_UNAVAILABLE in UNREACHABLE: snapshotError, checkoutGone false), for committed (PROBE) and uncommitted (SCAN) reviews.
  await reviewed();
  const bin = fs.mkdtempSync(path.join(path.dirname(w.repo.dir), 'bin-'));
  for (const tool of ['sh', 'ls', 'awk', 'wc', 'cp', 'touch', 'mkdir', 'rm', 'cat', 'realpath', 'readlink']) {
    fs.symlinkSync(execFileSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).trim(), path.join(bin, tool));
  }
  w.cc.state.execEnv = { PATH: bin };
  const rows = ok(await reviews.listReviews({ project: 'app' })).reviews;
  assert.equal(rows.length, 3);
  for (const r of rows) assert.deepEqual([r.kind, r.snapshotError, r.checkoutGone], [r.kind, 'GIT_UNAVAILABLE', false]);
  assert.equal((await checkoutInfo({ project: 'app', worktree: 'feature' }).catch((e) => e)).code, 'GIT_UNAVAILABLE');
});

test('list rows run concurrently under ROW_CONCURRENCY, and the list keeps newest-first order', async () => {
  // Invariant: a list request never has more than ROW_CONCURRENCY rows (so execs) in flight, does run rows in parallel, and returns rows in store order.
  w = await world();
  w.repo.write('a.js', editLines({ 5: 'live' }));
  for (let i = 0; i < 8; i++) {
    const { review } = ok(await reviews.openReview({ project: 'app', kind: 'uncommitted' }, HUMAN));
    ok(await reviews.patchReview(review.id, { status: 'closed' }));
  }
  const expected = store.list().sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).map((r) => r.id);
  w.cc.state.execDelayMs = 20;
  w.cc.state.execMaxInFlight = 0;
  const listed = ok(await reviews.listReviews({ project: 'app' })).reviews;
  assert.deepEqual(listed.map((r) => r.id), expected);
  assert.ok(w.cc.state.execMaxInFlight <= ROW_CONCURRENCY, `max in flight ${w.cc.state.execMaxInFlight}`);
  assert.ok(w.cc.state.execMaxInFlight > 1, 'rows ran in parallel');
});

test('mapLimit keeps input order, never exceeds its limit, and stops starting items after the first rejection', async () => {
  // Invariant: results in input order; at most `limit` pending; a rejection rejects the whole call and no later item starts.
  let running = 0;
  let peak = 0;
  const started = [];
  const fn = async (x) => {
    started.push(x);
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setImmediate(r));
    running--;
    if (x === 'boom') throw new Error('boom');
    return x * 2;
  };
  assert.deepEqual(await mapLimit([5, 1, 4, 2, 3, 6, 7], 3, fn), [10, 2, 8, 4, 6, 12, 14]);
  assert.equal(peak, 3);
  started.length = 0;
  await assert.rejects(mapLimit(['boom', 1, 2, 3, 4, 5], 2, fn), /boom/);
  // The rejection surfaces while the other worker's item is still in flight; let it settle, and give any worker that
  // would go on several more turns to start its next item, before reading what ever started.
  const tick = () => new Promise((r) => setImmediate(r));
  while (running) await tick();
  for (let i = 0; i < 5; i++) await tick();
  assert.deepEqual(started, ['boom', 1], 'only the items in flight at the rejection ever started');
  assert.deepEqual(await mapLimit([], 4, fn), []);
});
