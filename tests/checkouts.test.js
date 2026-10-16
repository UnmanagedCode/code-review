import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fakeCc } from './_fakeCc.js';
import { attempt } from '../src/refusals.js';
import { resolveCheckout, forkPoints, sessions, sessionCheckout, isConductorProject } from '../src/checkouts.js';

let cc;
let tmp;
beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-co-'));
  process.env.CODE_REVIEW_CC_TIMEOUT_MS = '100';
  cc = await fakeCc({
    projects: [{ name: 'app', path: tmp, system: 'local' }, { name: 'remote', path: '/r', system: 'box' }, { name: 'bare', path: '/b' }],
    worktrees: {
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

test('a non-local project is refused PROJECT_NOT_LOCAL; absent system means local; unknown ones are refused', async () => {
  assert.equal((await attempt(() => resolveCheckout({ project: 'remote', worktree: null }))).code, 'PROJECT_NOT_LOCAL');
  assert.equal((await resolveCheckout({ project: 'bare', worktree: null })).path, '/b');
  assert.equal((await attempt(() => resolveCheckout({ project: 'nope', worktree: null }))).code, 'PROJECT_UNKNOWN');
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
