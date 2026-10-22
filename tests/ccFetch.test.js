import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fakeCc } from './_fakeCc.js';
import { tempStore } from './_store.js';
import { makeRepo, localPlace } from './_git.js';
import { projects, ccTimeoutMs, DEFAULT_TIMEOUT_MS } from '../src/cc.js';
import { exec } from '../src/exec.js';
import { MAX_ATTEMPTS } from '../src/ccFetch.js';
import { logEvent, logPath, LOG_MAX_BYTES } from '../src/opsLog.js';
import * as git from '../src/git.js';

let store;
let cc;
let repos = [];
beforeEach(async () => {
  mock.method(console, 'error', () => {});
  store = tempStore();
  cc = await fakeCc({ projects: [{ name: 'app', path: '/app' }] });
});
afterEach(() => {
  cc.close();
  store.cleanup();
  for (const r of repos) r.cleanup();
  repos = [];
  for (const k of ['CODE_REVIEW_CC_TIMEOUT_MS', 'CODE_REVIEW_GIT_TIMEOUT_MS']) delete process.env[k];
  mock.restoreAll();
});

const logLines = () => fs.readFileSync(logPath(), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const code = async (p) => p.then(() => null, (e) => e.code);
const hits = (route) => cc.state.hits.filter((h) => h === route).length;
const here = localPlace('/');
const reset = (n = Infinity) => { cc.state.execHook = () => (n-- > 0 ? 'reset' : undefined); };

test('default GET budget is DEFAULT_TIMEOUT_MS and the env overrides it', () => {
  assert.equal(ccTimeoutMs(), DEFAULT_TIMEOUT_MS);
  process.env.CODE_REVIEW_CC_TIMEOUT_MS = '250';
  assert.equal(ccTimeoutMs(), 250);
});

test('a slow GET within the budget succeeds without a retry', async () => {
  process.env.CODE_REVIEW_CC_TIMEOUT_MS = '500';
  cc.state.delayMs = 150;
  assert.equal((await projects()).length, 1);
  assert.equal(hits('GET /api/projects'), 1);
});

test('a GET reset once then answered is retried and the recovery is logged', async () => {
  cc.state.resetNext = 1;
  assert.equal((await projects()).length, 1);
  assert.equal(hits('GET /api/projects'), 2);
  const rec = logLines().filter((l) => l.outcome === 'recovered');
  assert.equal(rec.length, 1);
  assert.equal(rec[0].attempts, 2);
  assert.equal(rec[0].route, 'GET /api/projects');
});

test('GET retries are bounded by MAX_ATTEMPTS', async () => {
  cc.state.resetNext = Infinity;
  assert.equal(await code(projects()), 'CONDUCTOR_UNAVAILABLE');
  assert.equal(hits('GET /api/projects'), MAX_ATTEMPTS);
});

test('a GET timeout is retried once, not more', async () => {
  process.env.CODE_REVIEW_CC_TIMEOUT_MS = '50';
  cc.state.mode = 'hang';
  assert.equal(await code(projects()), 'CONDUCTOR_UNAVAILABLE');
  assert.equal(hits('GET /api/projects'), 2);
  const last = logLines().at(-1);
  assert.equal(last.cause, 'TimeoutError');
  assert.equal(last.attempts, 2);
});

test('a GET that cc answered with an error is not retried', async () => {
  cc.state.mode = 'error';
  assert.equal(await code(projects()), 'CONDUCTOR_UNAVAILABLE');
  assert.equal(hits('GET /api/projects'), 1);
});

test('a refused connection is retried, then logged with its cause', async () => {
  const closed = http.createServer();
  await new Promise((r) => closed.listen(0, '127.0.0.1', r));
  const { port } = closed.address();
  await new Promise((r) => closed.close(r));
  process.env.CONDUCTOR_URL = `http://127.0.0.1:${port}`;
  assert.equal(await code(projects()), 'CONDUCTOR_UNAVAILABLE');
  const last = logLines().at(-1);
  assert.equal(last.cause, 'ECONNREFUSED');
  assert.equal(last.attempts, MAX_ATTEMPTS);
});

test('retries back off, and the wait grows', async () => {
  process.env.CODE_REVIEW_CC_RETRY_MS = '40';
  cc.state.resetNext = Infinity;
  const t0 = Date.now();
  await code(projects());
  assert.ok(Date.now() - t0 >= 160, 'waited base + 3 x base');
});

test('a read-only exec reset once is retried', async () => {
  reset(1);
  const r = await exec(here, ['true'], { readOnly: true });
  assert.equal(r.code, 0);
  assert.equal(cc.state.execCalls.length, 2);
});

test('an exec without readOnly is never retried', async () => {
  reset();
  assert.equal(await code(exec(here, ['true'])), 'CONDUCTOR_UNAVAILABLE');
  assert.equal(cc.state.execCalls.length, 1);
});

test('read-only exec retries are bounded by MAX_ATTEMPTS', async () => {
  reset();
  assert.equal(await code(exec(here, ['true'], { readOnly: true })), 'CONDUCTOR_UNAVAILABLE');
  assert.equal(cc.state.execCalls.length, MAX_ATTEMPTS);
});

test('a read-only exec that hits the fetch deadline is not retried', async () => {
  process.env.CODE_REVIEW_GIT_TIMEOUT_MS = '100';
  cc.state.execHook = () => 'hang';
  assert.equal(await code(exec(here, ['true'], { readOnly: true })), 'CONDUCTOR_UNAVAILABLE');
  assert.equal(cc.state.execCalls.length, 1);
});

test("cc's exec answers are not retried, whatever they say", async () => {
  const answers = [
    [{ status: 502, body: { error: 'x', code: 'SYSTEM_UNREACHABLE' } }, 'SYSTEM_UNREACHABLE'],
    [{ status: 504, body: { error: 'x', code: 'EXEC_TIMEOUT' } }, 'GIT_TIMEOUT'],
    [{ status: 500, body: { error: 'boom' } }, undefined],
    [{ status: 404, raw: '<pre>Cannot POST</pre>' }, 'CONDUCTOR_UNAVAILABLE'],
    [{ status: 200, raw: 'not json' }, 'CONDUCTOR_UNAVAILABLE'],
  ];
  for (const [answer, expected] of answers) {
    cc.state.execCalls = [];
    cc.state.execHook = () => answer;
    assert.equal(await code(exec(here, ['true'], { readOnly: true })), expected, JSON.stringify(answer));
    assert.equal(cc.state.execCalls.length, 1, JSON.stringify(answer));
  }
});

test('git read-only calls retry on a reset and side-effecting ones never do', async () => {
  const r = makeRepo();
  repos.push(r);
  const sha = r.commit({ 'a.txt': 'a\n' });
  const at = localPlace(r.dir);
  const argvHas = (...xs) => (b) => xs.every((x) => b.argv.includes(x));
  const script = (s) => (b) => b.argv[0] === 'sh' && String(b.argv[2]).includes(s);
  const cases = [
    ['resolveCommit', argvHas('--end-of-options'), () => git.resolveCommit(at, 'HEAD'), true],
    ['headOf', argvHas('--quiet'), () => git.headOf(at), true],
    ['emptyTree', argvHas('hash-object'), () => git.emptyTree(at), true],
    ['mergeBase', argvHas('merge-base'), () => git.mergeBase(at, sha, sha), true],
    ['parentOf', argvHas('rev-list'), () => git.parentOf(at, sha), true],
    ['show', argvHas('show'), () => git.show(at, sha, 'a.txt'), true],
    ['statusOf', argvHas('status'), () => git.statusOf(at), true],
    ['diffBetween', argvHas('--full-index'), () => git.diffBetween(at, sha, sha), true],
    ['renames', argvHas('--name-status'), () => git.renames(at, sha, sha), true],
    ['commitLog', argvHas('log'), () => git.commitLog(at), true],
    ['currentBranch', argvHas('symbolic-ref'), () => git.currentBranch(at), true],
    ['untracked', argvHas('ls-files'), () => git.untracked(at), true],
    ['exists', script('[ -e'), () => git.exists(at), true],
    ['objectsExist', script('cat-file -e'), () => git.objectsExist(at, [sha]), true],
    ['sizes', script('ls -ldn'), () => git.sizes(at, ['a.txt']), true],
    ['diffUntrackedBatch', script('--no-index'), () => git.diffUntrackedBatch(at, [{ rel: 'a.txt', size: 2 }]), true],
    ['readWorktreeFile', script('realpath'), () => git.readWorktreeFile(at, 'a.txt'), true],
    ['withPrivateIndex: create', script('mktemp -d'), () => git.withPrivateIndex(at, async () => {}), false],
    ['withPrivateIndex: alternates', script('alternates'), () => git.withPrivateIndex(at, async () => {}), false],
    ['addToIndex', argvHas('update-index'), () => git.addToIndex(at, ['a.txt']), false],
    ['removeTemp', (b) => b.argv[0] === 'rm', () => git.removeTemp(at, '/tmp/cr-index-x'), false],
    ['diffWorktree', argvHas('--full-index'), () => git.diffWorktree(at, sha), false],
  ];
  for (const [name, matches, run, retried] of cases) {
    cc.state.execCalls = [];
    let fired = false;
    cc.state.execHook = (b) => { if (!fired && matches(b)) { fired = true; return 'reset'; } return undefined; };
    if (retried) await run(); else assert.equal(await code(run()), 'CONDUCTOR_UNAVAILABLE', name);
    assert.ok(fired, `${name}: its call was reached`);
    assert.equal(cc.state.execCalls.filter(matches).length, retried ? 2 : 1, name);
  }
});

test('every CONDUCTOR_UNAVAILABLE is logged with route, elapsed time, attempts and cause', async () => {
  const last = async (run, route) => {
    assert.equal(await code(run()), 'CONDUCTOR_UNAVAILABLE', route);
    const l = logLines().at(-1);
    assert.equal(l.code, 'CONDUCTOR_UNAVAILABLE');
    assert.equal(l.route, route);
    assert.ok(Number.isInteger(l.elapsedMs) && l.elapsedMs >= 0);
    assert.equal(typeof l.attempts, 'number');
    assert.ok(l.cause && l.reason && l.at);
    return l;
  };
  cc.state.mode = 'error';
  assert.equal((await last(projects, 'GET /api/projects')).cause, 'HTTP 500');
  cc.state.mode = 'ok';
  cc.state.execHook = () => 'reset';
  assert.equal((await last(() => exec(here, ['true']), 'POST /api/exec')).attempts, 1);
  cc.state.execHook = () => ({ status: 404, raw: 'nope' });
  assert.equal((await last(() => exec(here, ['true']), 'POST /api/exec')).cause, 'HTTP 404');
  cc.state.execHook = () => ({ status: 200, raw: 'nope' });
  assert.equal((await last(() => exec(here, ['true']), 'POST /api/exec')).cause, 'non-JSON body');
  const url = process.env.CONDUCTOR_URL;
  delete process.env.CONDUCTOR_URL;
  try {
    const l = await last(projects, 'GET /api/projects');
    assert.equal(l.attempts, 0);
    assert.equal(l.cause, 'CONDUCTOR_URL unset');
  } finally {
    process.env.CONDUCTOR_URL = url;
  }
});

test('the log rotates past LOG_MAX_BYTES', () => {
  fs.mkdirSync(path.dirname(logPath()), { recursive: true });
  const old = 'x'.repeat(LOG_MAX_BYTES + 1);
  fs.writeFileSync(logPath(), old);
  logEvent({ n: 1 });
  assert.equal(fs.readFileSync(`${logPath()}.1`, 'utf8'), old);
  assert.deepEqual(logLines(), [{ n: 1 }]);
});

test('a log write failure never changes the refusal', async () => {
  const saved = { s: process.env.CODE_REVIEW_STORE, p: process.env.PROJECTS_ROOT };
  delete process.env.CODE_REVIEW_STORE;
  delete process.env.PROJECTS_ROOT;
  cc.state.mode = 'error';
  try {
    assert.equal(await code(projects()), 'CONDUCTOR_UNAVAILABLE');
    assert.ok(console.error.mock.calls.length > 0);
  } finally {
    process.env.CODE_REVIEW_STORE = saved.s;
    if (saved.p !== undefined) process.env.PROJECTS_ROOT = saved.p;
  }
});
