import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { world } from './_world.js';
import { tempStore } from './_store.js';
import { start } from '../server.js';

// GET /api/checkout/commit: one ref of a checkout resolved to its commit record, refused exactly as POST /reviews refuses it.

let dist;
let server;
let base;
let bootStore;
let w;
before(async () => {
  bootStore = tempStore();
  dist = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-commit-dist-'));
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
beforeEach(async () => { w = await world(); });
afterEach(() => w.cleanup());

const get = async (q) => {
  const res = await fetch(`${base}/checkout/commit?${new URLSearchParams(q)}`);
  return { status: res.status, body: await res.json() };
};
const open = async (body) => {
  const res = await fetch(`${base}/reviews`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};

test('a branch, HEAD, a relative ref and a short sha each resolve to that commit\'s full record', async () => {
  // Pins: the endpoint answers the commit the ref names (not HEAD, not the first log line), with commitLog's fields.
  const wt = w.addWorktree();
  const first = wt.commit({ 'a.js': 'one\n' }, 'first on feature');
  const second = wt.commit({ 'a.js': 'two\n' }, 'second on feature');
  const main = w.repo.git('rev-parse', 'main');
  const at = async (ref) => (await get({ project: 'app', worktree: 'feature', ref })).body;

  const head = await at('HEAD');
  assert.equal(head.ok, true);
  assert.deepEqual(head.commit, { sha: second, short: second.slice(0, 7), author: 'T', date: '2024-01-01T00:00:00Z', subject: 'second on feature', merge: false });
  assert.equal((await at('HEAD~1')).commit.sha, first);
  assert.equal((await at('HEAD~1')).commit.subject, 'first on feature');
  assert.equal((await at('main')).commit.sha, main);
  assert.equal((await at(first.slice(0, 9))).commit.sha, first);
  assert.equal((await get({ project: 'app', ref: 'br-feature' })).body.commit.sha, second, 'the main checkout resolves refs too');
});

test('a merge commit is flagged as one', async () => {
  // Pins: `merge` counts the parents of the resolved commit.
  const wt = w.addWorktree();
  wt.commit({ 'x.js': 'x\n' }, 'side');
  w.repo.commit({ 'y.js': 'y\n' }, 'main moves');
  w.repo.git('merge', '-q', '--no-ff', '-m', 'merge feature', 'br-feature');
  const merged = (await get({ project: 'app', ref: 'HEAD' })).body.commit;
  assert.equal(merged.subject, 'merge feature');
  assert.equal(merged.merge, true);
  assert.equal((await get({ project: 'app', ref: 'HEAD^2' })).body.commit.merge, false);
});

test('a ref that is not ref-shaped is BAD_REF, an unknown one REF_UNKNOWN: the same refusals as opening a review', async () => {
  // Pins: one validator (git.checkRef / git.resolveCommit) behind both surfaces, so a link cannot pass what POST /reviews refuses.
  w.addWorktree();
  for (const [ref, code, status] of [['-x', 'BAD_REF', 400], ['a b', 'BAD_REF', 400], ['nope', 'REF_UNKNOWN', 404]]) {
    const r = await get({ project: 'app', worktree: 'feature', ref });
    assert.equal(r.status, status, ref);
    assert.equal(r.body.code, code, ref);
    assert.equal((await open({ project: 'app', worktree: 'feature', kind: 'commit', sha: ref })).body.code, code, `POST /reviews agrees on ${ref}`);
  }
  assert.equal((await get({ project: 'app', worktree: 'feature' })).body.code, 'BAD_REF', 'a missing ref is refused, not read as HEAD');
});

test('an unknown project or worktree, a vanished checkout and a missing project are refused', async () => {
  // Pins: the checkout is resolved (and must exist) before any git call.
  assert.deepEqual([(await get({ project: 'nope', ref: 'HEAD' })).body.code, (await get({ project: 'nope', ref: 'HEAD' })).status], ['PROJECT_UNKNOWN', 404]);
  assert.equal((await get({ project: 'app', worktree: 'ghost', ref: 'HEAD' })).body.code, 'CHECKOUT_UNKNOWN');
  w.cc.state.worktrees.app.push({ worktreeName: 'gone', worktreePath: path.join(path.dirname(w.repo.dir), 'never-made'), branch: 'g', baseBranch: 'main', baseSha: 'x' });
  assert.equal((await get({ project: 'app', worktree: 'gone', ref: 'HEAD' })).body.code, 'CHECKOUT_GONE');
  assert.equal((await get({ ref: 'HEAD' })).status, 400);
});
