import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { world, HUMAN, agent, editLines } from './_world.js';
import { makeRepo, lines } from './_git.js';
import { start } from '../server.js';
import * as reviews from '../src/reviews.js';
import * as threads from '../src/threads.js';
import * as submissions from '../src/submissions.js';
import * as inbox from '../src/inbox.js';
import * as store from '../src/store.js';

let w;
beforeEach(async () => {
  w = await world();
  w.session('s-author', { worktree: 'feature' });
});
afterEach(() => w.cleanup());

const ok = (res) => { assert.equal(res.ok, true, JSON.stringify(res)); return res; };
const at = (file, startLine) => ({ file, side: 'new', startLine, endLine: startLine });
const author = agent('s-author');

// Only Date is mocked, so the fake cc's sockets and timers keep running. Each `clock.at(n)` is a distinct, later wall-clock time.
const T0 = Date.parse('2026-01-01T00:00:00.000Z');
const iso = (n) => new Date(T0 + n * 60_000).toISOString();
const clockOf = (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  return { at: (n) => { t.mock.timers.setTime(T0 + n * 60_000); return iso(n); } };
};

const list = async () => ok(await inbox.listInbox()).reviews;
const item = async (id) => (await list()).find((r) => r.id === id);
const lastActivity = (id) => store.read(id).lastActivityAt;

/** A range review on worktree `feature` with one changed hunk in a.js, recipient s-author. */
async function onFeature(actor = HUMAN) {
  const wt = w.addWorktree();
  wt.commit({ 'a.js': editLines({ 2: 'top-edit' }) });
  const { review } = ok(await reviews.openReview({ project: 'app', worktree: 'feature', recipient: actor.kind === 'human' ? 's-author' : undefined }, actor));
  return { wt, review };
}
const deliver = async (id) => {
  const { submission } = ok(await submissions.composeSubmission(id));
  ok(await submissions.recordResult(id, submission.id, { ok: true }));
};

/** A second project `lib` (main checkout only) registered with the fake cc. */
function addProject(name = 'lib') {
  const repo = makeRepo();
  repo.commit({ 'l.js': lines(5, 'l') });
  w.cc.state.projects.push({ name, path: repo.dir, system: 'local' });
  w.cc.state.worktrees[name] = [];
  return repo;
}

test('the inbox lists the open reviews of every project and checkout; closed ones are left out', async (t) => {
  // Invariant: the inbox's scope is every stored review with status 'open', whatever its project or checkout.
  const lib = addProject();
  t.after(() => lib.cleanup());
  const { review: feature } = await onFeature();
  w.repo.write('a.js', editLines({ 5: 'dirty' }));
  const main = ok(await reviews.openReview({ project: 'app', kind: 'uncommitted' }, HUMAN)).review;
  const libReview = ok(await reviews.openReview({ project: 'lib', kind: 'commit' }, HUMAN)).review;
  const closed = ok(await reviews.openReview({ project: 'app', kind: 'commit' }, HUMAN)).review;
  ok(await reviews.patchReview(closed.id, { status: 'closed' }));
  const rows = await list();
  assert.deepEqual(rows.map((r) => r.id).sort(), [feature.id, main.id, libReview.id].sort());
  assert.deepEqual(rows.map((r) => [r.project, r.worktree]).sort(), [['app', 'feature'], ['app', null], ['lib', null]].sort());
});

test('rows are ordered by lastActivityAt, newest first, ties by id descending', async (t) => {
  // Invariant: the sort is lastActivityAt descending, then id descending.
  const clock = clockOf(t);
  w.repo.write('a.js', editLines({ 5: 'dirty' }));
  clock.at(1);
  const unc = ok(await reviews.openReview({ project: 'app', kind: 'uncommitted' }, HUMAN)).review;
  clock.at(2);
  const commit = ok(await reviews.openReview({ project: 'app', kind: 'commit' }, HUMAN)).review;
  const { review: feature } = await onFeature();
  clock.at(3);
  ok(await threads.annotate(unc.id, HUMAN, { anchor: at('a.js', 5), kind: 'comment', body: 'latest' }));
  const rows = await list();
  assert.deepEqual(rows.map((r) => r.lastActivityAt), [iso(3), iso(2), iso(2)]);
  assert.deepEqual(rows.map((r) => r.id), [unc.id, ...[commit.id, feature.id].sort().reverse()]);
});

test('every activity stamps lastActivityAt', async (t) => {
  // Invariant: each touch/bump call site (messages, verdicts set or cleared, thread status, compose, result, a refresh adding a round by either actor) moves lastActivityAt to now.
  const clock = clockOf(t);
  const { wt, review } = await onFeature();
  assert.equal(lastActivity(review.id), iso(0), 'opening stamps createdAt');
  const [hunk] = ok(await reviews.diff(review.id, {})).files[0].hunks;
  let n = 0;
  const stamps = async (what, fn) => {
    const now = clock.at(++n);
    await fn();
    assert.equal(lastActivity(review.id), now, what);
  };
  let tid;
  await stamps('agent annotate', async () => { tid = ok(await threads.annotate(review.id, author, { anchor: at('a.js', 2), kind: 'question', body: 'q' })).thread.id; });
  await stamps('human reply', async () => ok(await threads.reply(review.id, HUMAN, tid, { body: 'a' })));
  await stamps('agent reply', async () => ok(await threads.reply(review.id, author, tid, { body: 'b' })));
  await stamps('verdict accept', async () => ok(await reviews.setVerdict(review.id, hunk.id, 'accepted')));
  await stamps('verdict cleared to pending', async () => ok(await reviews.setVerdict(review.id, hunk.id, 'pending')));
  await stamps('accept file', async () => ok(await reviews.acceptFile(review.id, 'a.js', [hunk.id])));
  await stamps('thread resolve', async () => ok(await threads.setThreadStatus(review.id, tid, { status: 'resolved' })));
  await stamps('thread reopen', async () => ok(await threads.setThreadStatus(review.id, tid, { status: 'open' })));
  let sid;
  await stamps('compose', async () => { sid = ok(await submissions.composeSubmission(review.id)).submission.id; });
  await stamps('failed result', async () => ok(await submissions.recordResult(review.id, sid, { ok: false, code: 'SEND_FAILED' })));
  await stamps('delivered result', async () => ok(await submissions.recordResult(review.id, sid, { ok: true })));
  wt.commit({ 'b.js': 'human\n' });
  await stamps('human refresh adding a round', async () => assert.equal(ok(await reviews.refreshReview(review.id, HUMAN)).round, 2));
  wt.commit({ 'b.js': 'agent\n' });
  await stamps('agent refresh adding a round', async () => assert.equal(ok(await reviews.refreshReview(review.id, author)).round, 3));
  assert.equal((await item(review.id)).lastActivityAt, iso(n), 'the row shows the stored stamp');
});

test('non-activities leave lastActivityAt unchanged', async (t) => {
  // Invariant: markRead, PATCH (title, recipient, status), an unchanged refresh and the uncommitted sweep write without touching lastActivityAt.
  const clock = clockOf(t);
  w.session('s-other', { worktree: 'feature' });
  const { review } = await onFeature();
  ok(await threads.annotate(review.id, author, { anchor: at('a.js', 2), kind: 'comment', body: 'x' }));
  const stamp = lastActivity(review.id);
  let n = 0;
  const still = async (what, fn) => {
    clock.at(++n);
    await fn();
    assert.equal(lastActivity(review.id), stamp, what);
  };
  await still('markRead', async () => ok(await threads.markRead(review.id)));
  await still('PATCH title', async () => ok(await reviews.patchReview(review.id, { title: 'renamed' })));
  await still('PATCH recipient', async () => ok(await reviews.patchReview(review.id, { recipient: 's-other' })));
  await still('PATCH status', async () => {
    ok(await reviews.patchReview(review.id, { status: 'closed' }));
    ok(await reviews.patchReview(review.id, { status: 'open' }));
  });
  await still('unchanged refresh', async () => assert.equal(ok(await reviews.refreshReview(review.id, author)).unchanged, true));

  const wt = w.addWorktree('unc');
  wt.write('a.js', editLines({ 3: 'temp' }));
  const unc = ok(await reviews.openReview({ project: 'app', worktree: 'unc', kind: 'uncommitted' }, HUMAN)).review;
  ok(await threads.annotate(unc.id, HUMAN, { anchor: at('a.js', 3), kind: 'comment', body: 'on temp' }));
  const uncStamp = lastActivity(unc.id);
  clock.at(++n);
  wt.write('a.js', lines(20));
  const rev = store.read(unc.id).rev;
  ok(await reviews.getReview(unc.id));
  assert.ok(store.read(unc.id).rev > rev, 'the sweep wrote (it dropped the thread)');
  assert.equal(lastActivity(unc.id), uncStamp, 'uncommitted sweep');
});

test('turn: yours before any submission, the agent\'s after delivery, yours again once an agent replies', async () => {
  // Invariant: turnOf is 'agent' only for a delivered newest submission with agentSeq <= its seq; an agent message advances agentSeq.
  const { review } = await onFeature();
  assert.equal((await item(review.id)).turn, 'human');
  const tid = ok(await threads.annotate(review.id, HUMAN, { anchor: at('a.js', 2), kind: 'question', body: 'why?' })).thread.id;
  await deliver(review.id);
  assert.equal((await item(review.id)).turn, 'agent');
  ok(await threads.reply(review.id, author, tid, { body: 'because' }));
  assert.equal((await item(review.id)).turn, 'human');
  ok(await threads.reply(review.id, HUMAN, tid, { body: 'ok' }));
  await deliver(review.id);
  assert.equal((await item(review.id)).turn, 'agent');
  ok(await threads.annotate(review.id, author, { anchor: at('a.js', 2), kind: 'comment', body: 'new thread' }));
  assert.equal((await item(review.id)).turn, 'human', 'an agent annotate also hands the turn back');
});

test('turn: human activity and human refreshes keep it with the agent; an agent refresh adding a round hands it back, an unchanged one does not', async () => {
  // Invariant: only agent activity advances agentSeq; refreshReview sets it only for an agent actor and only when a round is added.
  const { wt, review } = await onFeature();
  const tid = ok(await threads.annotate(review.id, HUMAN, { anchor: at('a.js', 2), kind: 'question', body: 'why?' })).thread.id;
  await deliver(review.id);
  ok(await threads.reply(review.id, HUMAN, tid, { body: 'also this' }));
  assert.equal((await item(review.id)).turn, 'agent', 'a human message while waiting');
  assert.equal(ok(await reviews.refreshReview(review.id, author)).unchanged, true);
  assert.equal((await item(review.id)).turn, 'agent', 'an unchanged agent refresh');
  wt.commit({ 'b.js': 'human\n' });
  assert.equal(ok(await reviews.refreshReview(review.id, HUMAN)).round, 2);
  assert.equal((await item(review.id)).turn, 'agent', 'a human refresh adding a round');
  wt.commit({ 'b.js': 'agent\n' });
  assert.equal(ok(await reviews.refreshReview(review.id, author)).round, 3);
  assert.equal((await item(review.id)).turn, 'human', 'an agent refresh adding a round');
});

test('turn is yours while the newest submission is pending or failed', async () => {
  // Invariant: turnOf requires the newest submission's status to be 'delivered'.
  const { review } = await onFeature();
  ok(await threads.annotate(review.id, HUMAN, { anchor: at('a.js', 2), kind: 'question', body: 'why?' }));
  const { submission } = ok(await submissions.composeSubmission(review.id));
  assert.equal((await item(review.id)).turn, 'human', 'pending');
  ok(await submissions.recordResult(review.id, submission.id, { ok: false, code: 'SESSION_NOT_LIVE' }));
  assert.equal((await item(review.id)).turn, 'human', 'failed');
  ok(await submissions.recordResult(review.id, submission.id, { ok: true }));
  assert.equal((await item(review.id)).turn, 'agent', 'delivered');
});

test('a row carries the review\'s identity, label, title, round, unread count and seenByHuman', async () => {
  // Invariant: inboxItem maps id, project, worktree, branch, kind, label (targetLabel), title, current round, unread (unreadOf), seenByHuman and lastActivityAt.
  const { wt, review } = await onFeature(author);
  ok(await threads.annotate(review.id, author, { anchor: at('a.js', 2), kind: 'comment', body: 'one' }));
  ok(await threads.annotate(review.id, author, { anchor: at('a.js', 2), kind: 'comment', body: 'two' }));
  wt.commit({ 'b.js': 'x\n' });
  ok(await reviews.refreshReview(review.id, author));
  const row = await item(review.id);
  assert.deepEqual(row, {
    id: review.id, project: 'app', worktree: 'feature', branch: 'br-feature', kind: 'range', label: 'main...br-feature',
    title: 'main...br-feature', round: 2, unread: 2, seenByHuman: false, lastActivityAt: store.read(review.id).lastActivityAt,
    turn: 'human', checkoutGone: false,
  });
  ok(await reviews.patchReview(review.id, { title: 'Named' }));
  ok(await threads.markRead(review.id));
  const read = await item(review.id);
  assert.deepEqual([read.title, read.unread, read.seenByHuman], ['Named', 0, true]);
});

test('a row\'s label is the review\'s target label, independent of its title', async () => {
  // Invariant: inboxItem's label comes from targetLabel (the target), title from the stored title.
  const { review } = await onFeature();
  ok(await reviews.patchReview(review.id, { title: 'Named' }));
  const row = await item(review.id);
  assert.deepEqual([row.label, row.title], ['main...br-feature', 'Named']);
});

test('turn is the agent\'s when the delivered submission was composed at the agent\'s own seq', async () => {
  // Invariant: turnOf's boundary is inclusive: agentSeq == the newest delivered submission's seq is 'agent'.
  const { review } = await onFeature();
  ok(await threads.annotate(review.id, author, { anchor: at('a.js', 2), kind: 'comment', body: 'agent first' }));
  const { submission } = ok(await submissions.composeSubmission(review.id));
  ok(await submissions.recordResult(review.id, submission.id, { ok: true }));
  const stored = store.read(review.id);
  assert.equal(stored.submissions.at(-1).seq, stored.agentSeq, 'no bump between the agent and the compose');
  assert.equal((await item(review.id)).turn, 'agent');
});

test('open reviews missing either migrated field are each logged and left out; the migrated rows still show', async (t) => {
  // Invariant: listInbox drops (via store.logSkipped) an open review lacking lastActivityAt, and one lacking only agentSeq, each on its own, instead of failing; no fallback value is invented.
  const errors = t.mock.method(console, 'error', () => {});
  const { review: current } = await onFeature();
  w.repo.write('a.js', editLines({ 5: 'dirty' }));
  const other = ok(await reviews.openReview({ project: 'app', kind: 'uncommitted' }, HUMAN)).review;
  const noStamp = ok(await reviews.openReview({ project: 'app', kind: 'commit' }, HUMAN)).review;
  const noAgentSeq = ok(await reviews.openReview({ project: 'app', worktree: 'feature', kind: 'commit' }, HUMAN)).review;
  const strip = (id, field) => {
    const raw = store.read(id);
    delete raw[field];
    store.write(raw);
  };
  strip(noStamp.id, 'lastActivityAt');
  strip(noAgentSeq.id, 'agentSeq');
  assert.deepEqual((await list()).map((r) => r.id).sort(), [current.id, other.id].sort());
  const logged = (id) => errors.mock.calls.some((c) => String(c.arguments[0]).includes(`review ${id} left out of the inbox`));
  assert.ok(logged(noStamp.id), 'the review missing lastActivityAt is logged');
  assert.ok(logged(noAgentSeq.id), 'the review missing agentSeq is logged');
});

test('listing the inbox runs no git: zero exec calls', async () => {
  // Invariant: listInbox never calls /api/exec (no summaryOf, no snapshot, no status).
  await onFeature();
  w.repo.write('a.js', editLines({ 5: 'dirty' }));
  ok(await reviews.openReview({ project: 'app', kind: 'uncommitted' }, HUMAN));
  const before = w.cc.state.execCalls.length;
  assert.equal((await list()).length, 2);
  assert.equal(w.cc.state.execCalls.length, before);
});

test('cc lookups are bounded: one location call per project and one worktrees call per project with a worktree review, never the project list, none without open reviews', async (t) => {
  // Invariant: per fetch, cc.location(p) at most once per project with an open review, cc.worktrees(p) at most once per project with an open worktree review, cc.projects() never, and no cc call when nothing is open.
  const lib = addProject();
  t.after(() => lib.cleanup());
  await onFeature();
  w.addWorktree('second').commit({ 'b.js': 'x\n' });
  ok(await reviews.openReview({ project: 'app', worktree: 'second' }, HUMAN));
  ok(await reviews.openReview({ project: 'lib', kind: 'commit' }, HUMAN));
  const hits = w.cc.state.hits;
  let from = hits.length;
  assert.equal((await list()).length, 3);
  assert.deepEqual(hits.slice(from).sort(), ['GET /api/projects/app/location', 'GET /api/projects/app/worktrees', 'GET /api/projects/lib/location']);
  for (const r of store.list()) ok(await reviews.patchReview(r.id, { status: 'closed' }));
  from = hits.length;
  assert.deepEqual(await list(), []);
  assert.deepEqual(hits.slice(from), []);
});

test('checkoutGone: true when cc no longer lists the worktree or the project, false while listed, null when cc fails', async () => {
  // Invariant: a worktree row is gone iff cc lists neither the project nor the worktree; a main row iff cc does not list the project; a failed lookup is null and the inbox still answers.
  const { review: feature } = await onFeature();
  const other = w.addWorktree('other');
  other.commit({ 'b.js': 'x\n' });
  const gone = ok(await reviews.openReview({ project: 'app', worktree: 'other' }, HUMAN)).review;
  const main = ok(await reviews.openReview({ project: 'app', kind: 'commit' }, HUMAN)).review;
  const marks = async () => Object.fromEntries((await list()).map((r) => [r.id, r.checkoutGone]));
  assert.deepEqual(await marks(), { [feature.id]: false, [gone.id]: false, [main.id]: false });
  other.destroy();
  assert.deepEqual(await marks(), { [feature.id]: false, [gone.id]: true, [main.id]: false });
  w.cc.state.mode = 'error';
  assert.deepEqual(await marks(), { [feature.id]: null, [gone.id]: null, [main.id]: null });
  w.cc.state.mode = 'ok';
  const rows = w.cc.state.projects;
  w.cc.state.projects = [];
  assert.deepEqual(await marks(), { [feature.id]: true, [gone.id]: true, [main.id]: true });
  w.cc.state.projects = rows;
});

test('GET /api/inbox serves {ok, reviews}', async (t) => {
  // Invariant: the route is wired to listInbox.
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-inbox-dist-'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html>');
  const server = await start({ port: 0, distDir: dist });
  t.after(() => { server.closeAllConnections(); server.close(); fs.rmSync(dist, { recursive: true, force: true }); });
  const { review } = await onFeature();
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/inbox`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.reviews.map((r) => [r.id, r.turn, r.checkoutGone]), [[review.id, 'human', false]]);
});
