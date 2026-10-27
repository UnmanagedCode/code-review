import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeRepo, localPlace } from './_git.js';
import { fakeCc } from './_fakeCc.js';
import { exec, EXEC_MAX_OUTPUT_BYTES, EXEC_MAX_TIMEOUT_MS, UNREACHABLE, placeKey } from '../src/exec.js';
import * as git from '../src/git.js';
import { buildSnapshot } from '../src/snapshot.js';
import { attempt, Refusal, HTTP_STATUS } from '../src/refusals.js';

let cc;
let r;
before(async () => { cc = await fakeCc(); });
after(() => cc.close());
afterEach(() => {
  r?.cleanup();
  r = null;
  cc.state.execCalls = [];
  cc.state.execHook = null;
  delete process.env.CODE_REVIEW_GIT_TIMEOUT_MS;
});
const repo = () => { r = makeRepo(); r.commit({ 'a.txt': 'a\n' }); return localPlace(r.dir); };
const answer = (status, body) => () => ({ status, body });

// What git itself lists as repository-local (`git rev-parse --local-env-vars`), plus GIT_NAMESPACE: none may leak in from the target.
const LOCATION_VARS = [...execFileSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8' }).split('\n').filter(Boolean), 'GIT_NAMESPACE'];
// git(1)'s documented trace targets: none may make a read write a file.
const TRACE_VARS = ['GIT_TRACE', 'GIT_TRACE_PACK_ACCESS', 'GIT_TRACE_PACKET', 'GIT_TRACE_PACKFILE', 'GIT_TRACE_PERFORMANCE', 'GIT_TRACE_REFS',
  'GIT_TRACE_SETUP', 'GIT_TRACE_SHALLOW', 'GIT_TRACE_CURL', 'GIT_TRACE_FSMONITOR', 'GIT_TRACE2', 'GIT_TRACE2_EVENT', 'GIT_TRACE2_PERF'];
const unsetsLocation = (script) => {
  const first = script.split('\n')[0].split(' ');
  return first[0] === 'unset' && [...LOCATION_VARS, ...TRACE_VARS].every((v) => first.includes(v));
};

test('a git call is form B at cwd /, argv form with the fsmonitor, splitIndex and -C prefix, base64, with the base env overlay', async () => {
  const at = repo();
  await git.headOf(at);
  const [b] = cc.state.execCalls;
  assert.equal(b.system, 'local');
  assert.equal('remoteId' in b, false, 'local carries no remoteId');
  assert.equal(b.cwd, '/');
  assert.equal(b.encoding, 'base64');
  assert.equal('shell' in b, false);
  // git runs under an sh that first unsets every git location variable the target's environment might carry.
  assert.deepEqual([b.argv[0], b.argv[1], b.argv[3]], ['sh', '-c', 'sh']);
  assert.ok(unsetsLocation(b.argv[2]), b.argv[2]);
  assert.deepEqual(b.argv[2].split('\n').slice(1), ['command -v git >/dev/null 2>&1 || exit 12', 'exec "$@"'], 'checks git can run, then runs it');
  assert.deepEqual(b.argv.slice(4, 11), ['git', '-c', 'core.fsmonitor=false', '-c', 'core.splitIndex=false', '-C', r.dir]);
  assert.deepEqual(b.env, { LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0' });
  assert.equal(b.maxOutputBytes, git.MAX_DIFF_BYTES);
});

test('a script call is sh -c with the checkout as $1 and the base env overlay; scripts call git with the same config', async () => {
  const at = repo();
  r.git('rm', '--cached', '-q', 'a.txt');
  r.write('a.txt', 'edited\n');
  r.write('u.txt', 'u\n');
  const snap = await buildSnapshot({ kind: 'uncommitted', checkout: at, prefetch: [{ side: 'new', file: 'a.txt' }] });
  await snap.lines('new', 'u.txt');
  await git.sizes(at, ['u.txt']);
  await git.probe(at, { path: r.dir, status: true });
  const scripts = cc.state.execCalls.filter((b) => b.argv[0] === 'sh');
  assert.ok(scripts.length >= 5);
  for (const b of scripts) {
    assert.deepEqual([b.argv[1], b.argv[3], b.argv[4]], ['-c', 'sh', r.dir]);
    assert.ok(unsetsLocation(b.argv[2]), `every script unsets the git location variables first: ${b.argv[2].slice(0, 60)}`);
    if (b.argv[2].includes('git ')) assert.ok(b.argv[2].includes('git -c core.fsmonitor=false -c core.splitIndex=false '), 'scripts call git with the same config');
    assert.deepEqual(b.env, { LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0' });
  }
});

test('a target where git cannot be found refuses GIT_UNAVAILABLE, from argv git calls and git scripts alike; scripts without git still run', async () => {
  // Invariant: a missing git is GIT_UNAVAILABLE (as cc's EXEC_SPAWN_FAILED is), never a plain Error, REF_UNKNOWN or SNAPSHOT_GONE; a script that runs no git is not refused for it.
  const at = repo();
  const sha = r.git('rev-parse', 'HEAD');
  const bin = fs.mkdtempSync(path.join(path.dirname(r.dir), 'bin-')); // in the repo's own temp dir
  for (const tool of ['sh', 'ls', 'awk', 'wc', 'cp', 'touch', 'mkdir', 'rm', 'cat', 'realpath', 'readlink']) {
    fs.symlinkSync(execFileSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).trim(), path.join(bin, tool));
  }
  cc.state.execEnv = { PATH: bin };
  try {
    const refused = async (what, run) => assert.equal((await attempt(run)).code, 'GIT_UNAVAILABLE', what);
    await refused('headOf', () => git.headOf(at));
    await refused('resolveCommit', () => git.resolveCommit(at, 'HEAD'));
    await refused('statusOf', () => git.statusOf(at));
    await refused('probe', () => git.probe(at, { path: r.dir, status: true, shas: [sha] }));
    await refused('probe without status', () => git.probe(at, { path: r.dir, shas: [sha] }));
    await refused('uncommitted snapshot', () => buildSnapshot({ kind: 'uncommitted', checkout: at }));
    assert.equal(await git.exists(at), true, '[ -e ] needs no git');
    assert.equal(await git.readWorktreeFile(at, 'a.txt'), 'a\n', 'reading a working-tree file needs no git');
  } finally {
    cc.state.execEnv = {};
  }
});

test('a remote place sends its system and remoteId; maxOutputBytes and timeoutMs are clamped to cc\'s caps', async () => {
  cc.state.execHook = answer(200, { exitCode: 0, stdout: '', stderr: '' });
  process.env.CODE_REVIEW_GIT_TIMEOUT_MS = String(10 * EXEC_MAX_TIMEOUT_MS);
  await exec({ system: 'box', remoteId: 'b1', path: '/x' }, ['true'], { maxOutputBytes: 10 * EXEC_MAX_OUTPUT_BYTES });
  delete process.env.CODE_REVIEW_GIT_TIMEOUT_MS;
  await exec(localPlace('/'), ['true']);
  const [b, dflt] = cc.state.execCalls;
  assert.equal(b.system, 'box');
  assert.equal(b.remoteId, 'b1');
  assert.equal(b.maxOutputBytes, EXEC_MAX_OUTPUT_BYTES);
  assert.equal(b.timeoutMs, EXEC_MAX_TIMEOUT_MS);
  assert.equal(dflt.timeoutMs, 120_000, 'the default per-command timeout');
});

test('stdin travels as base64 bytes; without one the command sees EOF', async () => {
  const at = localPlace('/');
  const bytes = Buffer.from([0x00, 0xff, 0x0a, 0xe2, 0x82, 0xac]);
  const echoed = await exec(at, ['cat'], { stdin: bytes });
  assert.ok(echoed.stdout.equals(bytes));
  assert.equal(cc.state.execCalls[0].stdinB64, bytes.toString('base64'));
  const none = await exec(at, ['cat']);
  assert.equal(none.code, 0);
  assert.equal(none.stdout.length, 0);
  assert.equal('stdinB64' in cc.state.execCalls[1], false);
});

const MAPPING = [
  ['SYSTEM_UNREACHABLE', 502, 'SYSTEM_UNREACHABLE'],
  ['REMOTE_NOT_FOUND', 502, 'SYSTEM_UNREACHABLE'],
  ['SYSTEM_NOT_REGISTERED', 501, 'SYSTEM_UNREACHABLE'],
  ['SYSTEM_NO_PROVIDER', 501, 'SYSTEM_UNREACHABLE'],
  ['SYSTEM_NO_REMOTES', 501, 'SYSTEM_UNREACHABLE'],
  ['SYSTEMS_UNAVAILABLE', 501, 'SYSTEM_UNREACHABLE'],
  ['EXEC_TIMEOUT', 504, 'GIT_TIMEOUT'],
  ['EXEC_OUTPUT_TOO_LARGE', 422, 'DIFF_TOO_LARGE'],
  ['EXEC_SPAWN_FAILED', 422, 'GIT_UNAVAILABLE'],
];

test('each cc refusal maps to its code-review refusal and HTTP status', async () => {
  const expectedStatus = { SYSTEM_UNREACHABLE: 502, GIT_TIMEOUT: 504, DIFF_TOO_LARGE: 413, GIT_UNAVAILABLE: 502 };
  for (const [ccCode, status, code] of MAPPING) {
    cc.state.execHook = answer(status, { error: `cc says ${ccCode}`, code: ccCode, errno: 'ENOENT' });
    const res = await attempt(() => exec(localPlace('/'), ['true']));
    assert.equal(res.code, code, ccCode);
    assert.equal(HTTP_STATUS[code], expectedStatus[code], code);
  }
  assert.deepEqual(UNREACHABLE.map((c) => HTTP_STATUS[c]), [502, 504, 502]);
  assert.equal(HTTP_STATUS.TEMP_UNUSABLE, 502, 'a target without a usable temp base is the system failing to serve the read');
});

test('an unreachable refusal names the system and cc\'s code', async () => {
  cc.state.execHook = answer(502, { error: 'provider died', code: 'REMOTE_NOT_FOUND' });
  const res = await attempt(() => exec({ system: 'box', remoteId: 'b1', path: '/x' }, ['true']));
  assert.match(res.reason, /box\/b1/);
  assert.match(res.reason, /REMOTE_NOT_FOUND: provider died/);
});

test('real fake-cc refusals: an unregistered system, a timed-out command, too much output, a missing binary', async () => {
  assert.equal((await attempt(() => exec({ system: 'nope', remoteId: null, path: '/' }, ['true']))).code, 'SYSTEM_UNREACHABLE');
  process.env.CODE_REVIEW_GIT_TIMEOUT_MS = '200';
  assert.equal((await attempt(() => exec(localPlace('/'), ['sleep', '5']))).code, 'GIT_TIMEOUT');
  delete process.env.CODE_REVIEW_GIT_TIMEOUT_MS;
  assert.equal((await attempt(() => exec(localPlace('/'), ['head', '-c', '1000', '/dev/zero'], { maxOutputBytes: 10 }))).code, 'DIFF_TOO_LARGE');
  const spawn = await attempt(() => exec(localPlace('/'), ['cr-no-such-binary']));
  assert.equal(spawn.code, 'GIT_UNAVAILABLE');
  assert.match(spawn.reason, /ENOENT/);
});

test('a cc that predates /api/exec (a 404 without a code) is CONDUCTOR_UNAVAILABLE naming the route', async () => {
  cc.state.execHook = () => ({ status: 404, raw: '<pre>Cannot POST /api/exec</pre>' });
  const res = await attempt(() => exec(localPlace('/'), ['true']));
  assert.equal(res.code, 'CONDUCTOR_UNAVAILABLE');
  assert.match(res.reason, /POST \/api\/exec/);
  cc.state.execHook = answer(404, { error: 'Not found' });
  assert.match((await attempt(() => exec(localPlace('/'), ['true']))).reason, /does not serve POST \/api\/exec/);
});

test('a cc that never answers, a non-JSON body or an unset CONDUCTOR_URL is CONDUCTOR_UNAVAILABLE', async () => {
  process.env.CODE_REVIEW_GIT_TIMEOUT_MS = '200';
  cc.state.execHook = () => 'hang';
  const started = Date.now();
  assert.equal((await attempt(() => exec(localPlace('/'), ['true']))).code, 'CONDUCTOR_UNAVAILABLE');
  assert.ok(Date.now() - started < 2000, 'gave up at the fetch deadline');
  cc.state.execHook = () => ({ status: 200, raw: 'not json' });
  assert.equal((await attempt(() => exec(localPlace('/'), ['true']))).code, 'CONDUCTOR_UNAVAILABLE');
  const saved = process.env.CONDUCTOR_URL;
  delete process.env.CONDUCTOR_URL;
  try {
    assert.equal((await attempt(() => exec(localPlace('/'), ['true']))).code, 'CONDUCTOR_UNAVAILABLE');
  } finally {
    process.env.CONDUCTOR_URL = saved;
  }
});

test('a request cc refuses as malformed is code-review\'s own bug: a plain Error, not a refusal', async () => {
  const e = await exec(localPlace('/'), []).then(() => null, (x) => x);
  assert.ok(e instanceof Error);
  assert.equal(e instanceof Refusal, false);
  assert.equal(e.code, 'INVALID_ARGUMENT');
  assert.equal(e.status, 400);
  cc.state.execHook = answer(500, { error: 'boom' });
  const e2 = await exec(localPlace('/'), ['true']).then(() => null, (x) => x);
  assert.equal(e2 instanceof Refusal, false);
  assert.match(e2.message, /HTTP 500/);
});

test('a git failure throws an Error carrying git\'s stderr; an allowed exit code resolves', async () => {
  const at = repo();
  const e = await git.run(at, ['rev-parse', '--verify', 'nope']).then(() => null, (x) => x);
  assert.equal(e.exitCode, 128);
  assert.match(e.message, /^git rev-parse failed: fatal/);
  assert.equal((await git.run(at, ['rev-parse', '--verify', '--quiet', 'nope'], { ok: [0, 1] })).code, 1);
});

test('blobs and working-tree files come back byte-exact: invalid UTF-8 and multibyte characters decode as git and fs do', async () => {
  const at = repo();
  const bytes = Buffer.concat([Buffer.from('café € \u{1F600}\n'), Buffer.from([0xff, 0xfe, 0x0a]), Buffer.from('é\n')]);
  fs.writeFileSync(path.join(r.dir, 'x.txt'), bytes);
  const sha = r.commit({});
  const expected = execFileSync('git', ['-C', r.dir, 'show', `${sha}:x.txt`]).toString('utf8');
  assert.equal(await git.show(at, sha, 'x.txt'), expected);
  assert.equal(await git.readWorktreeFile(at, 'x.txt'), fs.readFileSync(path.join(r.dir, 'x.txt'), 'utf8'));
  fs.writeFileSync(path.join(r.dir, 'x.txt'), Buffer.concat([bytes, Buffer.from([0xc3])]));
  const snap = await buildSnapshot({ kind: 'uncommitted', checkout: at });
  const live = fs.readFileSync(path.join(r.dir, 'x.txt'), 'utf8');
  assert.deepEqual(await snap.lines('new', 'x.txt'), live.split('\n'));
  assert.deepEqual(await snap.lines('old', 'x.txt'), expected.split('\n').slice(0, -1));
});

test('readWorktreeFile: a file is read whole; a missing file, a directory or an escaping symlink is null', async () => {
  const at = repo();
  r.write('d/n\nl.txt', 'newline name\n');
  fs.writeFileSync(path.join(path.dirname(r.dir), 'outside.txt'), 'secret\n');
  fs.symlinkSync(path.join(path.dirname(r.dir), 'outside.txt'), path.join(r.dir, 'out.txt'));
  fs.symlinkSync('a.txt', path.join(r.dir, 'in.txt'));
  assert.equal(await git.readWorktreeFile(at, 'd/n\nl.txt'), 'newline name\n');
  assert.equal(await git.readWorktreeFile(at, 'in.txt'), 'a\n');
  for (const rel of ['gone.txt', 'd', 'out.txt', '../repo/a.txt/..']) assert.equal(await git.readWorktreeFile(at, rel), null, rel);
  assert.equal(await git.readWorktreeFile({ ...at, path: `${r.dir}-gone` }, 'a.txt'), null, 'a vanished checkout');
});

test('exists asks the system: true for a present path, false for an absent one', async () => {
  const at = repo();
  assert.equal(await git.exists(at), true);
  assert.equal(await git.exists({ ...at, path: `${r.dir}/nope` }), false);
});

test('placeKey separates one path on two systems', () => {
  assert.notEqual(placeKey({ system: 'local', remoteId: null, path: '/a' }), placeKey({ system: 'box', remoteId: null, path: '/a' }));
  assert.notEqual(placeKey({ system: 'box', remoteId: 'x', path: '/a' }), placeKey({ system: 'box', remoteId: 'y', path: '/a' }));
});

test('no backend module spawns processes, and only the store touches the filesystem', () => {
  const dir = new URL('../src/', import.meta.url);
  for (const name of fs.readdirSync(dir)) {
    const src = fs.readFileSync(new URL(name, dir), 'utf8');
    assert.doesNotMatch(src, /node:child_process|from 'child_process'/, name);
    if (!['store.js', 'opsLog.js'].includes(name)) assert.doesNotMatch(src, /from 'node:fs'|from 'fs'|node:fs\/promises/, name);
  }
});
