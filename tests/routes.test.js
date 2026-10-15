import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { world, editLines } from './_world.js';
import { start } from '../server.js';
import { HTTP_STATUS } from '../src/refusals.js';

let dist;
let server;
let base;
let w;
before(async () => {
  dist = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-routes-dist-'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html>');
  server = await start({ port: 0, distDir: dist });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => {
  server.closeAllConnections();
  server.close();
  fs.rmSync(dist, { recursive: true, force: true });
});
beforeEach(async () => {
  w = await world();
  w.session('s-author', { worktree: 'feature' });
  w.addWorktree().commit({ 'a.js': editLines({ 2: 'top-edit', 18: 'bottom-edit' }) });
});
afterEach(() => w.cleanup());

const req = async (method, url, body) => {
  const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const openReview = async (extra = {}) => (await req('POST', '/reviews', { project: 'app', worktree: 'feature', recipient: 's-author', ...extra })).body;

test('GET /projects lists local projects; /checkout, /checkout/commits and /sessions describe a checkout', async () => {
  w.cc.state.projects.push({ name: 'far', path: '/f', system: 'box' });
  assert.deepEqual((await req('GET', '/projects')).body.projects, [{ name: 'app' }]);
  const co = (await req('GET', '/checkout?project=app&worktree=feature')).body;
  assert.equal(co.checkout.branch, 'br-feature');
  assert.equal(co.checkout.exists, true);
  assert.deepEqual(co.forkPoints.map((f) => f.ref), ['main']);
  assert.deepEqual(co.worktrees, [{ worktreeName: 'feature', branch: 'br-feature' }]);
  assert.equal((await req('GET', '/checkout?project=app')).body.checkout.branch, 'main');
  const commits = (await req('GET', '/checkout/commits?project=app&worktree=feature&limit=1')).body.commits;
  assert.equal(commits.length, 1);
  assert.match(commits[0].sha, /^[0-9a-f]{40}$/);
  const ss = (await req('GET', '/sessions?project=app&worktree=feature')).body.sessions;
  assert.deepEqual(ss.map((s) => [s.sessionId, s.attached]), [['s-author', true]]);
  assert.equal((await req('GET', '/checkout')).status, 400);
});

test('review lifecycle over HTTP: open, reuse, get, diff, file, commits, patch, delete', async () => {
  const opened = await openReview();
  assert.equal(opened.ok, true);
  assert.equal(opened.reused, false);
  const id = opened.review.id;
  assert.equal((await openReview()).reused, true);
  const detail = (await req('GET', `/reviews/${id}`)).body;
  assert.deepEqual(Object.keys(detail).sort(), ['files', 'ok', 'outdatedThreads', 'review', 'rounds', 'submissions']);
  const diff = (await req('GET', `/reviews/${id}/diff`)).body;
  assert.equal(diff.files[0].hunks.length, 2);
  assert.equal(diff.files[0].hunks[0].verdict, 'pending');
  assert.equal((await req('GET', `/reviews/${id}/diff?file=a.js`)).body.files.length, 1);
  assert.equal((await req('GET', `/reviews/${id}/file?path=a.js&side=new&start=1&end=2`)).body.lines.length, 2);
  assert.equal((await req('GET', `/reviews/${id}/commits`)).body.commits.length, 1);
  const sha = (await req('GET', `/reviews/${id}/commits`)).body.commits[0].sha;
  assert.equal((await req('GET', `/reviews/${id}/diff?commit=${sha}`)).body.readOnly, true);
  assert.equal((await req('PATCH', `/reviews/${id}`, { title: 'New' })).body.review.title, 'New');
  assert.equal((await req('GET', '/reviews?project=app')).body.reviews.length, 1);
  assert.equal((await req('DELETE', `/reviews/${id}`)).body.ok, true);
  assert.equal((await req('GET', `/reviews/${id}`)).status, 404);
});

test('verdicts, threads, messages, status, read, refresh, submissions each return their documented shape', async () => {
  const id = (await openReview()).review.id;
  const hunkId = (await req('GET', `/reviews/${id}/diff`)).body.files[0].hunks[0].id;
  const verdict = (await req('PUT', `/reviews/${id}/hunks/${hunkId}/verdict`, { verdict: 'rejected' })).body;
  assert.deepEqual([verdict.hunkId, verdict.verdict, verdict.review.mergeBlockers], [hunkId, 'rejected', 1]);

  const thread = (await req('POST', `/reviews/${id}/threads`, { anchor: { file: 'a.js', side: 'new', startLine: 2, endLine: 2 }, kind: 'finding', severity: 'minor', body: 'see a.js#L18' })).body.thread;
  assert.equal(thread.messages[0].citations[0].path, 'a.js');
  const replied = (await req('POST', `/reviews/${id}/threads/${thread.id}/messages`, { body: 'more' })).body.thread;
  assert.equal(replied.messages.length, 2);
  assert.equal((await req('PATCH', `/reviews/${id}/threads/${thread.id}`, { status: 'resolved' })).status, 400);
  const resolved = (await req('PATCH', `/reviews/${id}/threads/${thread.id}`, { status: 'resolved', disposition: 'fixed' })).body.thread;
  assert.deepEqual([resolved.status, resolved.disposition], ['resolved', 'fixed']);
  assert.equal((await req('POST', `/reviews/${id}/read`, {})).body.review.seenByHuman, true);
  assert.equal((await req('POST', `/reviews/${id}/refresh`)).body.unchanged, true);

  const sub = (await req('POST', `/reviews/${id}/submissions`)).body.submission;
  assert.match(sub.text, new RegExp(id));
  const done = (await req('POST', `/reviews/${id}/submissions/${sub.id}/result`, { ok: true })).body.submission;
  assert.equal(done.status, 'delivered');
});

test('refusals map to their HTTP status', async () => {
  const id = (await openReview()).review.id;
  const cases = [
    [await req('GET', '/reviews/r-0000000000'), 'REVIEW_UNKNOWN'],
    [await req('POST', '/reviews', { project: 'nope' }), 'PROJECT_UNKNOWN'],
    [await req('POST', '/reviews', { project: 'app', kind: 'range' }), 'BASE_REQUIRED'],
    [await req('POST', `/reviews/${id}/threads`, { anchor: { file: 'a.js', startLine: 99 }, kind: 'comment', body: 'x' }), 'LINE_OUT_OF_RANGE'],
    [await req('POST', `/reviews/${id}/threads`, { anchor: { file: 'zzz.js', startLine: 1 }, kind: 'comment', body: 'x' }), 'FILE_NOT_IN_DIFF'],
    [await req('POST', `/reviews/${id}/threads`, { anchor: { file: 'a.js', startLine: 1 }, kind: 'finding', body: 'x' }), 'SEVERITY_REQUIRED'],
    [await req('POST', `/reviews/${id}/threads/t9/messages`, { body: 'x' }), 'THREAD_UNKNOWN'],
    [await req('POST', `/reviews/${id}/submissions/s9/result`, { ok: true }), 'SUBMISSION_UNKNOWN'],
  ];
  for (const [res, code] of cases) {
    assert.equal(res.body.code, code);
    assert.equal(res.status, HTTP_STATUS[code], code);
  }
  w.cc.state.mode = 'error';
  const down = await req('GET', '/projects');
  assert.deepEqual([down.status, down.body.code], [502, 'CONDUCTOR_UNAVAILABLE']);
});

test('POST /mcp speaks the cc envelope', async () => {
  const id = (await openReview()).review.id;
  const ok = await req('POST', '/mcp', { tool: 'get_review', arguments: { review: id }, caller: { sessionId: 's-author', project: 'app' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.meta.id, id);
  assert.equal((await req('POST', '/mcp', {})).status, 400);
});

test('SSE delivers {id, rev} after a mutation and {id, deleted} after a delete', async () => {
  const ac = new AbortController();
  const res = await fetch(`${base}/events`, { signal: ac.signal });
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let seen = '';
  const until = async (re) => {
    while (!re.test(seen)) seen += decoder.decode((await reader.read()).value);
  };
  await until(/: connected/);
  const id = (await openReview()).review.id;
  await until(/event: review\ndata: \{"id":"r-[0-9a-f]+","rev":1\}/);
  await req('DELETE', `/reviews/${id}`);
  await until(new RegExp(`data: \\{"id":"${id}","deleted":true\\}`));
  ac.abort();
});

test('an unknown /api path is still a 404 JSON; malformed JSON is a 400 JSON', async () => {
  const miss = await fetch(`${base}/nowhere`);
  assert.equal(miss.status, 404);
  assert.match(miss.headers.get('content-type'), /json/);
  const bad = await fetch(`${base}/reviews`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).code, 'INVALID_ARGUMENT');
});

test('with the store unconfigured the API answers 503 STORE_UNCONFIGURED while /health still works', async () => {
  const saved = { s: process.env.CODE_REVIEW_STORE, p: process.env.PROJECTS_ROOT };
  delete process.env.CODE_REVIEW_STORE;
  delete process.env.PROJECTS_ROOT;
  try {
    const res = await req('GET', '/reviews');
    assert.deepEqual([res.status, res.body.code], [503, 'STORE_UNCONFIGURED']);
    assert.equal((await fetch(base.replace('/api', '/health'))).status, 200);
  } finally {
    process.env.CODE_REVIEW_STORE = saved.s;
    if (saved.p !== undefined) process.env.PROJECTS_ROOT = saved.p;
  }
});
