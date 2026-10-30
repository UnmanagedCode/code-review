import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { world, HUMAN, editLines } from './_world.js';
import * as reviews from '../src/reviews.js';
import * as threads from '../src/threads.js';
import * as store from '../src/store.js';
import { handle, _toolNames } from '../src/mcp.js';
import { reviewLink, threadLink } from '../src/links.js';
import { parseRoute } from '../frontend/src/lib/route.ts';

const manifest = JSON.parse(fs.readFileSync(new URL('../conductor.plugin.json', import.meta.url), 'utf8'));
const PREFIX = `http://cc.internal/#plugin/${manifest.id}/`;
const routeOf = (link) => {
  assert.ok(link.startsWith(`${PREFIX}?`), link);
  return parseRoute(link.slice(PREFIX.length));
};

let w;
beforeEach(async () => {
  w = await world();
  w.session('s-author', { worktree: 'feature' });
  w.session('s-rev', { worktree: 'feature' });
  w.session('s-cond', { project: '.conduct' });
});
afterEach(() => w.cleanup());

const call = async (tool, args, caller = { sessionId: 's-rev', project: 'app' }) => (await handle({ tool, arguments: args, caller })).body;
const result = async (tool, args, caller) => {
  const body = await call(tool, args, caller);
  assert.ok(body.result, JSON.stringify(body));
  return body.result;
};

async function reviewOnFeature(extra = {}) {
  const wt = w.addWorktree();
  wt.commit({ 'a.js': editLines({ 2: 'top-edit', 18: 'bottom-edit' }) });
  const out = await result('open_review', { project: 'app', worktree: 'feature', author: 's-author', ...extra }, { sessionId: 's-cond', project: '.conduct' });
  assert.equal(out.ok, true, JSON.stringify(out));
  return { wt, review: out.review };
}

test('the handler set equals the manifest tool names, in both directions', () => {
  assert.deepEqual([..._toolNames()].sort(), manifest.mcp.tools.map((t) => t.name).sort());
});

test('a missing tool is 400; an unknown tool is 200 with an error', async () => {
  assert.equal((await handle({ arguments: {} })).status, 400);
  assert.equal((await handle({ tool: '' })).status, 400);
  const unknown = await handle({ tool: 'nope', arguments: {}, caller: { sessionId: 's' } });
  assert.equal(unknown.status, 200);
  assert.match(unknown.body.error, /unknown tool/);
});

test('a domain refusal is 200 with {result:{ok:false, code}}; an unexpected failure is 200 {error}', async () => {
  const refused = await handle({ tool: 'get_review', arguments: { review: 'r-0000000000' }, caller: { sessionId: 's-rev', project: 'app' } });
  assert.equal(refused.status, 200);
  assert.equal(refused.body.result.code, 'REVIEW_UNKNOWN');
  w.cc.state.mode = 'error';
  const down = await handle({ tool: 'open_review', arguments: { project: 'app' }, caller: { sessionId: 's-rev', project: 'app' } });
  assert.equal(down.body.result.code, 'CONDUCTOR_UNAVAILABLE');
});

test('roles: .conduct is conductor, the range recipient is author, everyone else reviewer', async () => {
  const { review } = await reviewOnFeature();
  const mk = (caller) => result('annotate', { review: review.id, anchor: 'lines', kind: 'comment', body: 'x', file: 'a.js', startLine: 2 }, caller);
  assert.equal((await mk({ sessionId: 's-cond', project: '.conduct' })).thread.openedBy.role, 'conductor');
  assert.equal((await mk({ sessionId: 's-author', project: 'app' })).thread.openedBy.role, 'author');
  assert.equal((await mk({ sessionId: 's-rev', project: 'app' })).thread.openedBy.role, 'reviewer');
});

test('roles: on an uncommitted review even the recipient is a reviewer', async () => {
  const wt = w.addWorktree();
  wt.write('a.js', editLines({ 2: 'X' }));
  const out = await result('open_review', { kind: 'uncommitted' }, { sessionId: 's-author', project: 'app' });
  const t = await result('annotate', { review: out.review.id, anchor: 'lines', kind: 'finding', severity: 'nit', body: 'x', file: 'a.js', startLine: 2 }, { sessionId: 's-author', project: 'app' });
  assert.equal(t.thread.openedBy.role, 'reviewer');
});

test('list_threads passes owner; reply passes disposition and returns whether the thread closed', async () => {
  const { review } = await reviewOnFeature();
  const cond = { sessionId: 's-cond', project: '.conduct' };
  const finding = await result('annotate', { review: review.id, anchor: 'lines', kind: 'finding', severity: 'minor', body: 'x', file: 'a.js', startLine: 2 });
  const human = await threads.annotate(review.id, HUMAN, { anchor: { kind: 'lines', file: 'a.js', side: 'new', startLine: 18, endLine: 18 }, kind: 'comment', body: 'h' });
  const count = (owner, status) => call('list_threads', { review: review.id, owner, status }, cond);
  assert.equal((await count('agents')).meta.count, 1);
  assert.equal((await count('user')).meta.count, 1);
  assert.match((await count('agents', 'resolved')).text, /agents/);
  const closed = await result('reply', { review: review.id, thread: finding.thread.id, body: 'ok', resolve: true, disposition: 'fixed' }, cond);
  assert.deepEqual([closed.thread.status, closed.thread.disposition], ['resolved', 'fixed']);
  const proposed = await result('reply', { review: review.id, thread: human.thread.id, body: 'ok', resolve: true }, cond);
  assert.deepEqual([proposed.thread.status, proposed.thread.resolveProposed], ['open', true]);
});

test('no tool can set a verdict: no schema has a verdict property, and annotate/reply leave verdicts alone', async () => {
  for (const tool of manifest.mcp.tools) {
    assert.ok(!Object.keys(tool.inputSchema.properties).some((p) => /verdict|accept|reject/i.test(p)), tool.name);
  }
  const { review } = await reviewOnFeature();
  const h = (await reviews.diff(review.id, {})).files[0].hunks[0];
  await reviews.setVerdict(review.id, h.id, 'rejected');
  const t = await result('annotate', { review: review.id, anchor: 'lines', kind: 'comment', body: 'x', file: 'a.js', startLine: 2, verdict: 'accepted' });
  await result('reply', { review: review.id, thread: t.thread.id, body: 'y', resolve: true, verdict: 'accepted' });
  const after = (await reviews.getReview(review.id)).review;
  assert.deepEqual(after.counts.hunks, { pending: 1, accepted: 0, rejected: 1 });
});

test('get_review, list_threads and get_hunk answer {text, meta}; list_threads inlines cited code', async () => {
  const { review } = await reviewOnFeature();
  const hunk = (await reviews.diff(review.id, {})).files[0].hunks[0];
  const t = await result('annotate', { review: review.id, anchor: 'lines', kind: 'question', body: 'see a.js#L18-L18 and https://x/y.js#L1', file: 'a.js', startLine: 2 });

  const rollup = await call('get_review', { review: review.id });
  assert.equal(rollup.meta.id, review.id);
  assert.match(rollup.text, /a\.js/);

  const listed = await call('list_threads', { review: review.id });
  assert.equal(listed.meta.count, 1);
  assert.equal(listed.meta.counts.open, 1);
  assert.match(listed.text, new RegExp(`\\[${t.thread.id}\\] question · open · a\\.js#L2`));
  assert.match(listed.text, /bottom-edit/, 'the cited line is quoted');
  assert.match(listed.text, /a\.js#L18 @[0-9a-f]{7}/);
  assert.ok(!listed.text.includes('unresolved') && !/y\.js#L1 @/.test(listed.text), 'a URL is not a citation');
});

test('list_threads filters by status and file; get_hunk finds a hunk by id or by file and line', async () => {
  const { review } = await reviewOnFeature();
  const [h1, h2] = (await reviews.diff(review.id, {})).files[0].hunks;
  const t = await result('annotate', { review: review.id, anchor: 'hunk', kind: 'comment', body: 'x', hunk: h1.id });
  await result('reply', { review: review.id, thread: t.thread.id, body: 'done', resolve: true }, { sessionId: 's-rev', project: 'app' }).catch(() => {});
  assert.equal((await call('list_threads', { review: review.id, file: 'b.js' })).meta.count, 0);
  assert.equal((await call('list_threads', { review: review.id, status: 'all' })).meta.count, 1);

  const byId = await call('get_hunk', { review: review.id, hunk: h2.id });
  assert.deepEqual(byId.meta.hunks.map((h) => h.id), [h2.id]);
  assert.match(byId.text, /bottom-edit/);
  const byLine = await call('get_hunk', { review: review.id, file: 'a.js', line: h1.newStart + 1 });
  assert.equal(byLine.meta.hunks[0].id, h1.id);
  assert.deepEqual(byLine.meta.hunks[0].threadIds, [t.thread.id]);
  assert.equal((await call('get_hunk', { review: review.id, file: 'a.js' })).meta.hunks.length, 2);
  assert.equal((await result('get_hunk', { review: review.id })).code, 'INVALID_ARGUMENT');
});

test('open_review: a conductor opening becomes the recipient and its author argument is stored', async () => {
  const { review } = await reviewOnFeature();
  assert.equal(review.recipient, 's-cond');
  assert.equal(review.author, 's-author');
  assert.equal(review.recipientRole, 'conductor');
  assert.equal(review.createdBy.role, 'conductor');
  assert.equal(review.seenByHuman, false);
});

test('open_review without a project: a worker gets its own checkout, a conductor is told to name one, an unknown caller gets CHECKOUT_UNKNOWN', async () => {
  w.addWorktree().commit({ 'f.js': 'x\n' });
  const mine = await result('open_review', {}, { sessionId: 's-author', project: 'app' });
  assert.equal(mine.review.worktree, 'feature');
  assert.equal(mine.review.recipient, 's-author');
  assert.equal((await result('open_review', { author: 's-author' }, { sessionId: 's-cond', project: '.conduct' })).code, 'INVALID_ARGUMENT');
  assert.equal((await result('open_review', {}, { sessionId: 's-ghost', project: 'app' })).code, 'CHECKOUT_UNKNOWN');
});

test('open_review reuse never reassigns, in both directions', async () => {
  w.addWorktree().commit({ 'f.js': 'x\n' });
  const cond = { sessionId: 's-cond', project: '.conduct' };
  const worker = { sessionId: 's-author', project: 'app' };
  const first = await result('open_review', {}, worker);
  const again = await result('open_review', { project: 'app', worktree: 'feature', author: 's-author' }, cond);
  assert.equal(again.reused, true);
  assert.equal(again.review.id, first.review.id);
  assert.equal(again.review.recipient, 's-author');
  await reviews.patchReview(first.review.id, { status: 'closed' });
  const byCond = await result('open_review', { project: 'app', worktree: 'feature', author: 's-author' }, cond);
  const byWorker = await result('open_review', {}, worker);
  assert.equal(byWorker.reused, true);
  assert.equal(byWorker.review.recipient, 's-cond');
  assert.equal(byWorker.review.id, byCond.review.id);
});

test('get_review text names the conductor recipient and the author', async () => {
  const { review } = await reviewOnFeature();
  const text = (await call('get_review', { review: review.id })).text;
  assert.match(text, /recipient: s-cond \(conductor\)/);
  assert.match(text, /author: s-author/);
});

test('open_review: a worktree without a project is refused; so is a write with no calling session', async () => {
  assert.equal((await result('open_review', { worktree: 'feature' })).code, 'INVALID_ARGUMENT');
  assert.equal((await result('open_review', { project: 'app' }, { project: 'app' })).code, 'CALLER_UNKNOWN');
  const { review } = await reviewOnFeature();
  assert.equal((await result('annotate', { review: review.id, anchor: 'lines', kind: 'comment', body: 'x', file: 'a.js', startLine: 2 }, {})).code, 'CALLER_UNKNOWN');
  assert.equal((await result('refresh_review', { review: review.id }, {})).code, 'CALLER_UNKNOWN');
});

test('annotate needs either file+startLine or a hunk', async () => {
  const { review } = await reviewOnFeature();
  assert.equal((await result('annotate', { review: review.id, anchor: 'lines', kind: 'comment', body: 'x' })).code, 'INVALID_ARGUMENT');
});

test('refresh_review reports the new round', async () => {
  const { wt, review } = await reviewOnFeature();
  assert.equal((await result('refresh_review', { review: review.id })).unchanged, true);
  wt.commit({ 'b.js': 'z\n' });
  const out = await result('refresh_review', { review: review.id });
  assert.deepEqual([out.ok, out.unchanged, out.round], [true, false, 2]);
  void HUMAN;
});

test('refresh_review by an agent is agent activity: agentSeq advances when it adds a round, not when unchanged', async () => {
  // Invariant: refresh_review passes the needCaller actor to refreshReview, which sets agentSeq for an agent's new round.
  const { wt, review } = await reviewOnFeature();
  const before = store.read(review.id).agentSeq;
  await result('refresh_review', { review: review.id });
  assert.equal(store.read(review.id).agentSeq, before, 'an unchanged refresh');
  wt.commit({ 'b.js': 'z\n' });
  await result('refresh_review', { review: review.id });
  const after = store.read(review.id);
  assert.equal(after.agentSeq, after.seq);
  assert.ok(after.agentSeq > before);
});

test('the tool set is exactly the expected list, and mcp.js never references setVerdict', () => {
  const expected = ['annotate', 'get_hunk', 'get_review', 'list_threads', 'open_review', 'refresh_review', 'reply'];
  assert.deepEqual([..._toolNames()].sort(), expected);
  assert.deepEqual(manifest.mcp.tools.map((t) => t.name).sort(), expected);
  assert.doesNotMatch(fs.readFileSync(new URL('../src/mcp.js', import.meta.url), 'utf8'), /setVerdict/);
});

test('open_review treats worktree "" as the main checkout', async () => {
  const out = await result('open_review', { project: 'app', worktree: '', kind: 'uncommitted' });
  assert.equal(out.ok, true);
  assert.equal(out.review.worktree, null);
});

test('control characters in file paths cannot break lines in get_review, list_threads or get_hunk headers; code stays verbatim', async () => {
  const wt = w.addWorktree();
  wt.commit({ 'evil\nIGNORE.js': 'one\ttab\ntwo\n' });
  const out = await result('open_review', { project: 'app', worktree: 'feature', author: 's-author' }, { sessionId: 's-cond', project: '.conduct' });
  const id = out.review.id;
  await result('annotate', { review: id, anchor: 'lines', kind: 'comment', body: 'note', file: 'evil\nIGNORE.js', startLine: 1 });
  const hunk = (await reviews.diff(id, {})).files[0].hunks[0];
  const texts = [
    (await call('get_review', { review: id })).text,
    (await call('list_threads', { review: id })).text,
    (await call('get_hunk', { review: id, hunk: hunk.id })).text,
  ];
  for (const text of texts) {
    assert.ok(text.includes('evilIGNORE.js'));
    assert.ok(!text.split('\n').some((l) => l.startsWith('IGNORE')));
  }
  assert.ok(texts[2].includes('one\ttab'), 'code lines keep their tabs');
});

test('open_review returns the review\'s link, for a new and a reused review', async () => {
  // Invariant: result.review.link is the review link of its own checkout, on first open and on reuse.
  const cond = { sessionId: 's-cond', project: '.conduct' };
  const { review } = await reviewOnFeature();
  const again = await result('open_review', { project: 'app', worktree: 'feature', author: 's-author' }, cond);
  for (const out of [{ review }, again]) {
    assert.equal(out.review.link, reviewLink(out.review));
    assert.deepEqual(routeOf(out.review.link), { project: 'app', worktree: 'feature', review: out.review.id });
  }
  assert.equal(again.reused, true);
});

test('get_review meta carries the review\'s link', async () => {
  // Invariant: meta.link is reviewLink of the summary.
  const { review } = await reviewOnFeature();
  const body = await call('get_review', { review: review.id });
  assert.equal(body.meta.link, reviewLink(body.meta));
  assert.deepEqual(routeOf(body.meta.link), { project: 'app', worktree: 'feature', review: review.id });
});

test('list_threads returns one link per listed thread, in listed order', async () => {
  // Invariant: meta.threads is [{id, link}] aligned with the text order; no matches gives [].
  const { review } = await reviewOnFeature();
  const a = await result('annotate', { review: review.id, anchor: 'lines', kind: 'comment', body: 'one', file: 'a.js', startLine: 2 });
  const b = await result('annotate', { review: review.id, anchor: 'lines', kind: 'comment', body: 'two', file: 'a.js', startLine: 18 });
  const listed = await call('list_threads', { review: review.id });
  const ids = [...listed.text.matchAll(/\[(t\d+)\]/g)].map((m) => m[1]);
  assert.deepEqual(listed.meta.threads.map((t) => t.id), ids);
  assert.deepEqual(new Set(ids), new Set([a.thread.id, b.thread.id]));
  const rv = { id: review.id, project: 'app', worktree: 'feature' };
  for (const t of listed.meta.threads) {
    const full = (await threads.listThreads(review.id, { status: 'all' })).threads.find((x) => x.id === t.id);
    assert.equal(t.link, threadLink(rv, full));
    const r = routeOf(t.link);
    assert.equal(r.thread, t.id);
    assert.equal(r.file, 'a.js');
  }
  assert.deepEqual((await call('list_threads', { review: review.id, file: 'b.js' })).meta.threads, []);
});

test('a refusal carries no link', async () => {
  // Invariant: an unknown review is REVIEW_UNKNOWN with no link anywhere in the body.
  const body = await call('get_review', { review: 'r-0000000000' });
  assert.equal(body.result.code, 'REVIEW_UNKNOWN');
  assert.ok(!JSON.stringify(body).includes('link'));
});

// ---- file and review anchors ----

test('annotate maps `anchor` and its arguments for a file and for the review', async () => {
  // Invariant: the handler passes {kind: anchor, file, ...} through, so a file anchor stores {kind, file, round} and a review one {kind, round}.
  const { review } = await reviewOnFeature();
  const f = await result('annotate', { review: review.id, anchor: 'file', kind: 'comment', body: 'x', file: 'a.js' });
  assert.deepEqual([f.thread.anchor, f.fileSig.path], [{ kind: 'file', file: 'a.js', round: 1 }, 'a.js']);
  const r = await result('annotate', { review: review.id, anchor: 'review', kind: 'question', body: 'overall?' });
  assert.deepEqual([r.thread.anchor, r.fileSig], [{ kind: 'review', round: 1 }, null]);
});

test('annotate without `anchor`, or with a side on a file anchor, is refused INVALID_ARGUMENT', async () => {
  // Invariant: the handler adds no default kind or side, so buildAnchor refuses both.
  const { review } = await reviewOnFeature();
  assert.equal((await result('annotate', { review: review.id, kind: 'comment', body: 'x', file: 'a.js', startLine: 2 })).code, 'INVALID_ARGUMENT');
  assert.equal((await result('annotate', { review: review.id, anchor: 'file', kind: 'comment', body: 'x', file: 'a.js', side: 'new' })).code, 'INVALID_ARGUMENT');
  assert.equal((await result('annotate', { review: review.id, anchor: 'review', kind: 'comment', body: 'x', hunk: 'h' })).code, 'INVALID_ARGUMENT');
  assert.equal(store.read(review.id).threads.length, 0);
});

test('list_threads shows file and review threads by their label with no code fence, and tells their kind in meta', async () => {
  // Invariant: renderThreads labels by anchorLabel and fences only line anchors; meta.threads[].anchor is the kind; file= keeps file threads, never review ones.
  const { review } = await reviewOnFeature();
  const l = await result('annotate', { review: review.id, anchor: 'lines', kind: 'comment', body: 'one', file: 'a.js', startLine: 2 });
  const f = await result('annotate', { review: review.id, anchor: 'file', kind: 'comment', body: 'two', file: 'a.js' });
  const r = await result('annotate', { review: review.id, anchor: 'review', kind: 'comment', body: 'three' });
  const all = await call('list_threads', { review: review.id });
  assert.deepEqual(all.meta.threads.map((t) => [t.id, t.anchor]), [[l.thread.id, 'lines'], [f.thread.id, 'file'], [r.thread.id, 'review']]);
  const blocks = all.text.split('\n\n');
  assert.match(blocks[1], new RegExp(`^\\[${f.thread.id}\\] comment · open · a\\.js \\(whole file\\) · by `));
  assert.match(blocks[2], new RegExp(`^\\[${r.thread.id}\\] comment · open · the review · by `));
  assert.ok(blocks[0].includes('```'), 'a lines thread shows its lines');
  for (const b of blocks.slice(1)) assert.ok(!b.includes('```'), b);
  assert.deepEqual((await call('list_threads', { review: review.id, file: 'a.js' })).meta.threads.map((t) => t.id), [l.thread.id, f.thread.id]);
  const rv = { id: review.id, project: 'app', worktree: 'feature' };
  assert.deepEqual(routeOf(all.meta.threads[2].link), { project: 'app', worktree: 'feature', review: review.id, thread: r.thread.id, view: 'threads' });
  assert.deepEqual(routeOf(all.meta.threads[1].link), { project: 'app', worktree: 'feature', review: review.id, file: 'a.js', thread: f.thread.id });
  assert.equal(all.meta.threads[1].link, threadLink(rv, f.thread));
});

test('get_review text has a review threads line once the review has any', async () => {
  // Invariant: renderRollup adds `review threads: N open/M resolved` only when getReview returns review threads.
  const { review } = await reviewOnFeature();
  assert.ok(!(await call('get_review', { review: review.id })).text.includes('review threads:'));
  const a = await result('annotate', { review: review.id, anchor: 'review', kind: 'comment', body: 'one' });
  await result('annotate', { review: review.id, anchor: 'review', kind: 'comment', body: 'two' });
  assert.equal((await threads.setThreadStatus(review.id, a.thread.id, { status: 'resolved' })).ok, true);
  assert.match((await call('get_review', { review: review.id })).text, /^review threads: 1 open\/1 resolved$/m);
});
