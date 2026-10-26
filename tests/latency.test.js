// Call budgets: how many cc GETs and exec calls each request makes, the lookup cache and its invalidation, and the
// per-request concurrency cap.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { world, HUMAN, editLines } from './_world.js';
import { tempStore } from './_store.js';
import { start } from '../server.js';
import * as reviews from '../src/reviews.js';
import * as store from '../src/store.js';
import { checkoutInfo } from '../src/checkouts.js';
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
  assert.ok(!started.includes(4) && !started.includes(5), `started after the rejection: ${started}`);
  assert.deepEqual(await mapLimit([], 4, fn), []);
});
