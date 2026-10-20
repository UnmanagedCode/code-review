import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fakeCc } from './_fakeCc.js';
import { makeRepo, localPlace } from './_git.js';
import { attempt } from '../src/refusals.js';
import { resolveCheckout, forkPoints, sessions, sessionCheckout, isConductorProject, checkoutInfo } from '../src/checkouts.js';
import { statusOf } from '../src/git.js';

let cc;
let tmp;
beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-co-'));
  process.env.CODE_REVIEW_CC_TIMEOUT_MS = '100';
  cc = await fakeCc({
    projects: [
      { name: 'app', path: tmp, system: 'local' }, { name: 'bare', path: '/b' },
      { name: 'remote', path: '/cr-remote-box/main', system: 'box', remoteId: 'b1' },
    ],
    // The box system's virtual root, absent on this machine, is backed by `tmp`.
    systems: { box: { root: '/cr-remote-box', dir: tmp, remoteId: 'b1' } },
    worktrees: {
      remote: [{ worktreeName: 'rw', worktreePath: '/cr-remote-box/rw', branch: 'r', baseBranch: 'main', baseSha: 'r0' }],
      app: [
        { worktreeName: 'feature', worktreePath: path.join(tmp, 'wt-feature'), branch: 'feat', baseBranch: 'main', baseSha: 'f0' },
        { worktreeName: 'subtask', worktreePath: path.join(tmp, 'wt-sub'), branch: 'sub', baseBranch: 'feat', baseSha: 's0', baseWorktree: 'feature' },
        { worktreeName: 'loopA', worktreePath: '/x', branch: 'a', baseBranch: 'b', baseSha: '1', baseWorktree: 'loopB' },
        { worktreeName: 'loopB', worktreePath: '/y', branch: 'b', baseBranch: 'a', baseSha: '2', baseWorktree: 'loopA' },
      ],
    },
    instances: [
      { sessionId: 's-live', project: 'app', status: 'idle', title: 'w', conducted: true, worktree: { worktreeName: 'feature' } },
      { sessionId: 's-main', project: 'app', status: 'busy', title: 'm', worktree: null },
      { sessionId: 's-dead', project: 'app', status: 'exited', title: 'd', worktree: { worktreeName: 'feature' } },
      { sessionId: 's-crash', project: 'app', status: 'crashed', title: 'c', worktree: null },
      { sessionId: 's-cond', project: '.conduct', status: 'idle', title: 'cond', worktree: null },
    ],
  });
});
afterEach(() => {
  cc.close();
  delete process.env.CODE_REVIEW_CC_TIMEOUT_MS;
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('the main checkout resolves to the project path; a worktree to its row', async () => {
  const main = await resolveCheckout({ project: 'app', worktree: null });
  assert.equal(main.path, tmp);
  assert.equal(main.exists, true);
  const wt = await resolveCheckout({ project: 'app', worktree: 'feature' });
  assert.equal(wt.path, path.join(tmp, 'wt-feature'));
  assert.equal(wt.branch, 'feat');
  assert.equal(wt.exists, false);
});

test('a project on a system resolves with its placement, and its worktree inherits it; existence is asked of that system', async () => {
  fs.mkdirSync(path.join(tmp, 'main'));
  const main = await resolveCheckout({ project: 'remote', worktree: null });
  assert.deepEqual(main.place, { system: 'box', remoteId: 'b1', path: '/cr-remote-box/main' });
  assert.deepEqual(main.mainPlace, main.place);
  assert.equal(main.exists, true);
  const wt = await resolveCheckout({ project: 'remote', worktree: 'rw' });
  assert.deepEqual(wt.place, { system: 'box', remoteId: 'b1', path: '/cr-remote-box/rw' });
  assert.deepEqual(wt.mainPlace, main.place);
  assert.equal(wt.exists, false);
  fs.mkdirSync(path.join(tmp, 'rw'));
  assert.equal((await resolveCheckout({ project: 'remote', worktree: 'rw' })).exists, true);
  const probes = cc.state.execCalls.map((b) => [b.system, b.remoteId, b.argv.at(-1)]);
  assert.deepEqual(probes, [['box', 'b1', '/cr-remote-box/main'], ['box', 'b1', '/cr-remote-box/rw'], ['box', 'b1', '/cr-remote-box/rw']]);
});

test('absent system means local; unknown projects are refused', async () => {
  const bare = await resolveCheckout({ project: 'bare', worktree: null });
  assert.deepEqual(bare.place, localPlace('/b'));
  assert.equal(bare.exists, false);
  assert.equal((await attempt(() => resolveCheckout({ project: 'nope', worktree: null }))).code, 'PROJECT_UNKNOWN');
});

test('a system that cannot answer the existence probe refuses; the checkout is never reported missing', async () => {
  for (const [code, expected] of [['SYSTEM_UNREACHABLE', 'SYSTEM_UNREACHABLE'], ['REMOTE_NOT_FOUND', 'SYSTEM_UNREACHABLE']]) {
    cc.state.execHook = () => ({ status: 502, body: { error: 'down', code } });
    assert.equal((await attempt(() => resolveCheckout({ project: 'remote', worktree: null }))).code, expected);
    assert.equal((await attempt(() => resolveCheckout({ project: 'app', worktree: 'feature' }))).code, expected);
  }
  cc.state.execHook = () => ({ status: 504, body: { error: 'slow', code: 'EXEC_TIMEOUT' } });
  assert.equal((await attempt(() => checkoutInfo({ project: 'app', worktree: null }))).code, 'GIT_TIMEOUT');
});

test('statusOf: head, branch, detached and unborn HEAD, dirty from tracked and untracked changes', async () => {
  const r = makeRepo();
  try {
    const at = localPlace(r.dir);
    assert.deepEqual(await statusOf(at), { head: null, branch: 'main', dirty: false });
    r.write('u.txt', 'u\n');
    assert.deepEqual(await statusOf(at), { head: null, branch: 'main', dirty: true });
    const sha = r.commit({});
    assert.deepEqual(await statusOf(at), { head: sha, branch: 'main', dirty: false });
    r.write('u.txt', 'changed\n');
    assert.equal((await statusOf(at)).dirty, true);
    r.git('stash', '-q');
    r.git('checkout', '-q', '--detach');
    assert.deepEqual(await statusOf(at), { head: sha, branch: 'HEAD', dirty: false });
  } finally {
    r.cleanup();
  }
});

test('statusOf: a clean checkout with an upstream (branch.upstream and branch.ab headers) is not dirty', async () => {
  const r = makeRepo();
  try {
    r.commit({ 'a.txt': 'a\n' });
    r.git('checkout', '-q', '-b', 'feat', '--track', 'main');
    const sha = r.commit({ 'b.txt': 'b\n' }); // ahead of its upstream
    const raw = r.git('status', '--porcelain=v2', '--branch', '--no-ahead-behind');
    assert.match(raw, /^# branch\.upstream main$/m, 'the fixture has upstream headers');
    assert.match(raw, /^# branch\.ab /m);
    assert.deepEqual(await statusOf(localPlace(r.dir)), { head: sha, branch: 'feat', dirty: false });
  } finally {
    r.cleanup();
  }
});

test('checkoutInfo reads head, branch and dirty state in one status call after the existence probe', async () => {
  const r = makeRepo();
  try {
    const sha = r.commit({ 'a.txt': 'a\n' });
    r.write('a.txt', 'b\n');
    cc.state.projects.push({ name: 'real', path: r.dir, system: 'local' });
    cc.state.execCalls = [];
    const { checkout } = await checkoutInfo({ project: 'real', worktree: null });
    assert.deepEqual(checkout, { project: 'real', worktree: null, path: r.dir, branch: 'main', headSha: sha, dirty: true, exists: true });
    assert.equal(cc.state.execCalls.length, 2);
    const gone = await checkoutInfo({ project: 'bare', worktree: null });
    assert.deepEqual(gone.checkout, { project: 'bare', worktree: null, path: '/b', branch: null, headSha: null, dirty: false, exists: false });
  } finally {
    r.cleanup();
  }
});

test('an unknown worktree is refused CHECKOUT_UNKNOWN', async () => {
  assert.equal((await attempt(() => resolveCheckout({ project: 'app', worktree: 'ghost' }))).code, 'CHECKOUT_UNKNOWN');
});

test('the fork chain of a subtask lists its parent worktree then the main branch; the main checkout has none', async () => {
  const sub = await resolveCheckout({ project: 'app', worktree: 'subtask' });
  assert.deepEqual(await forkPoints(sub), [
    { ref: 'feat', label: 'feature', forkSha: 's0' },
    { ref: 'main', label: 'main', forkSha: 'f0' },
  ]);
  assert.deepEqual(await forkPoints(await resolveCheckout({ project: 'app', worktree: null })), []);
});

test('a cycle in the fork chain terminates', async () => {
  const a = await resolveCheckout({ project: 'app', worktree: 'loopA' });
  assert.equal((await forkPoints(a)).length, 2);
});

test('sessions: dead ones are not live; attached means same checkout and live; the conductor is flagged', async () => {
  const rows = await sessions({ project: 'app', worktree: 'feature' });
  const by = Object.fromEntries(rows.map((s) => [s.sessionId, s]));
  assert.equal(by['s-live'].live, true);
  assert.equal(by['s-live'].attached, true);
  assert.equal(by['s-live'].worktree, 'feature');
  assert.equal(by['s-dead'].live, false);
  assert.equal(by['s-dead'].attached, false);
  assert.equal(by['s-crash'].live, false);
  assert.equal(by['s-main'].attached, false);
  assert.equal(by['s-cond'].conductor, true);
  assert.equal(by['s-live'].conducted, true);
  const main = Object.fromEntries((await sessions({ project: 'app', worktree: null })).map((s) => [s.sessionId, s]));
  assert.equal(main['s-main'].attached, true);
  assert.equal(main['s-live'].attached, false);
});

test('sessionCheckout returns the instance\'s project and worktree, or null', async () => {
  assert.deepEqual(await sessionCheckout('s-live'), { project: 'app', worktree: 'feature' });
  assert.deepEqual(await sessionCheckout('s-main'), { project: 'app', worktree: null });
  assert.equal(await sessionCheckout('ghost'), null);
});

test('isConductorProject is true only for .conduct', () => {
  assert.equal(isConductorProject('.conduct'), true);
  assert.equal(isConductorProject('app'), false);
});

test('cc answering 500 or hanging past the timeout gives CONDUCTOR_UNAVAILABLE', async () => {
  cc.state.mode = 'error';
  assert.equal((await attempt(() => sessions({ project: 'app', worktree: null }))).code, 'CONDUCTOR_UNAVAILABLE');
  cc.state.mode = 'hang';
  assert.equal((await attempt(() => resolveCheckout({ project: 'app', worktree: null }))).code, 'CONDUCTOR_UNAVAILABLE');
});

test('an unset CONDUCTOR_URL gives CONDUCTOR_UNAVAILABLE', async () => {
  const saved = process.env.CONDUCTOR_URL;
  delete process.env.CONDUCTOR_URL;
  try {
    assert.equal((await attempt(() => sessions({ project: 'app', worktree: null }))).code, 'CONDUCTOR_UNAVAILABLE');
  } finally {
    process.env.CONDUCTOR_URL = saved;
  }
});
