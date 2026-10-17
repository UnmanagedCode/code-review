import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { world, editLines } from './_world.js';
import { bindRepo } from './_git.js';
import { tempStore } from './_store.js';
import { start } from '../server.js';
import { HTTP_STATUS } from '../src/refusals.js';
import * as store from '../src/store.js';

let dist;
let server;
let base;
let w;
let bootStore;
before(async () => {
  bootStore = tempStore(); // keep the API off a real store
  dist = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-routes-dist-'));
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

test('GET /reviews/:id/rounds/:n is a past round\'s view; diff and file take ?round=; an unknown round is 404 ROUND_UNKNOWN', async () => {
  const id = (await openReview()).review.id;
  const t = (await req('POST', `/reviews/${id}/threads`, { anchor: { file: 'a.js', side: 'new', startLine: 18 }, kind: 'comment', body: 'x' })).body.thread;
  bindRepo(w.cc.state.worktrees.app[0].worktreePath).commit({ 'a.js': ['ins1', ...editLines({ 2: 'top-edit', 18: 'bottom-edit' }).split('\n')].join('\n') });
  assert.equal((await req('POST', `/reviews/${id}/refresh`)).body.round, 2);
  const view = await req('GET', `/reviews/${id}/rounds/1`);
  assert.equal(view.status, 200);
  assert.deepEqual(Object.keys(view.body).sort(), ['counts', 'files', 'ok', 'outdatedThreads', 'readOnly', 'round']);
  assert.equal(view.body.round.n, 1);
  const diff = (await req('GET', `/reviews/${id}/diff?file=a.js&round=1`)).body;
  assert.deepEqual([diff.readOnly, diff.round.n, diff.files[0].threads.map((x) => [x.id, x.anchor.startLine])], [true, 1, [[t.id, 18]]]);
  assert.equal((await req('GET', `/reviews/${id}/diff?file=a.js`)).body.files[0].threads[0].anchor.startLine, 19);
  assert.deepEqual((await req('GET', `/reviews/${id}/file?path=a.js&start=1&end=1&round=1`)).body.lines, [{ n: 1, text: 'l1' }]);
  const unknown = await req('GET', `/reviews/${id}/rounds/9`);
  assert.deepEqual([unknown.status, unknown.body.code], [404, 'ROUND_UNKNOWN']);
  assert.equal(HTTP_STATUS.ROUND_UNKNOWN, 404);
  assert.equal((await req('GET', `/reviews/${id}/diff?round=9`)).status, 404);
  assert.equal((await req('GET', `/reviews/${id}/rounds/x`)).status, 400);
});

test('with an unparsable and a misfiled review file present, the list still answers 200 and a review can be opened', async (t) => {
  const errors = t.mock.method(console, 'error', () => {});
  const good = (await openReview()).review.id;
  const dir = path.join(w.store.dir, 'reviews');
  fs.writeFileSync(path.join(dir, `${store.newId()}.json`), '{ not json');
  fs.writeFileSync(path.join(dir, `${store.newId()}.json`), JSON.stringify({ ...store.read(good), id: store.newId() }));
  const listed = await req('GET', '/reviews?project=app');
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.reviews.map((r) => r.id), [good]);
  const fresh = await req('POST', '/reviews', { project: 'app', worktree: 'feature', kind: 'uncommitted' });
  assert.equal(fresh.status, 200);
  assert.equal(fresh.body.reused, false);
  assert.ok(errors.mock.callCount() >= 2, 'each skipped file is logged');
});

test('a 500 logs one cleaned header line, then only the stack\'s frames: a misfiled review\'s multi-line inner id forges no line', async (t) => {
  const errors = t.mock.method(console, 'error', () => {});
  const id = store.newId();
  fs.mkdirSync(path.join(w.store.dir, 'reviews'), { recursive: true });
  // Lines shaped like a log header, like a stack frame, and like plain text, plus an escape sequence.
  const inner = 'r-x\ncode-review: forged\u001b[31m\n    at forged (evil.js:1:1)\nplain forged';
  fs.writeFileSync(path.join(w.store.dir, 'reviews', `${id}.json`), JSON.stringify({ id: inner }));
  for (const [method, url] of [['GET', `/reviews/${id}`], ['GET', `/reviews/${id}/diff`], ['DELETE', `/reviews/${id}`]]) {
    errors.mock.resetCalls();
    const res = await req(method, url);
    assert.equal(res.status, 500, url);
    assert.match(res.body.reason, /\n/, 'precondition: the raw error message carries the newline');
    assert.equal(errors.mock.callCount(), 1, url);
    assert.equal(errors.mock.calls[0].arguments.length, 1, url);
    const [header, ...rest] = errors.mock.calls[0].arguments[0].split('\n');
    assert.doesNotMatch(header, /[\u0000-\u001f\u007f-\u009f]/, url);
    assert.match(header, new RegExp(`^code-review: ${method} /api${url} failed: MisfiledReview: `));
    assert.ok(rest.length > 0, `${url}: the stack's frames follow the header`);
    for (const l of rest) {
      assert.match(l, /^ {4}at \S/, `${url}: every line after the header is a frame`);
      assert.doesNotMatch(l, /forged|evil\.js|[\u0000-\u001f\u007f-\u009f]/, `${url}: no message text in the frames`);
    }
    assert.ok(rest.some((l) => l.includes('src/store.js')), `${url}: the frames locate the throw`);
  }
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

test('accept-file returns {file, accepted, review}; an unknown file is 404 FILE_NOT_IN_DIFF', async () => {
  const id = (await openReview()).review.id;
  const ids = (await req('GET', `/reviews/${id}/diff`)).body.files[0].hunks.map((h) => h.id);
  const res = await req('POST', `/reviews/${id}/accept-file`, { file: 'a.js', hunkIds: ids });
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.body).sort(), ['accepted', 'file', 'ok', 'review']);
  assert.deepEqual([res.body.file, res.body.accepted, res.body.review.counts.hunks.accepted], ['a.js', ids, 2]);
  const gone = await req('POST', `/reviews/${id}/accept-file`, { file: 'zzz.js', hunkIds: ids });
  assert.deepEqual([gone.status, gone.body.code], [404, 'FILE_NOT_IN_DIFF']);
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
  const listeners = store.changes.listenerCount('change');
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
  assert.equal(store.changes.listenerCount('change'), listeners + 1);
  ac.abort();
  for (let i = 0; i < 200 && store.changes.listenerCount('change') > listeners; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(store.changes.listenerCount('change'), listeners, 'a closed SSE client leaves no listener behind');
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

test('mutating routes refuse a non-JSON content type with 415 and change nothing; JSON with a charset is fine', async () => {
  const id = (await openReview()).review.id;
  const raw = (method, url, headers = {}) => fetch(base + url, { method, headers });
  const attempts = [
    ['POST', `/reviews/${id}/refresh`], ['POST', `/reviews/${id}/submissions`], ['POST', `/reviews/${id}/read`],
    ['PATCH', `/reviews/${id}`], ['DELETE', `/reviews/${id}`], ['PUT', `/reviews/${id}/hunks/h/verdict`], ['POST', `/reviews/${id}/accept-file`], ['POST', '/mcp'],
  ];
  for (const [method, url] of attempts) {
    for (const headers of [{}, { 'content-type': 'text/plain' }, { 'content-type': 'application/x-www-form-urlencoded' }]) {
      const res = await raw(method, url, headers);
      assert.equal(res.status, 415, `${method} ${url} ${JSON.stringify(headers)}`);
      assert.equal((await res.json()).code, 'UNSUPPORTED_MEDIA_TYPE');
    }
  }
  assert.equal((await req('GET', `/reviews/${id}`)).body.review.status, 'open', 'the delete did not happen');
  const ok = await raw('POST', `/reviews/${id}/refresh`, { 'content-type': 'application/json; charset=utf-8' });
  assert.equal(ok.status, 200);
  assert.equal((await fetch(`${base}/reviews`)).status, 200, 'GET needs no content type');
});
