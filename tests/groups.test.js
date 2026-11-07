import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { world, HUMAN, agent, editLines } from './_world.js';
import * as reviews from '../src/reviews.js';
import * as threads from '../src/threads.js';
import * as groups from '../src/groups.js';
import * as submissions from '../src/submissions.js';
import * as store from '../src/store.js';
import { roundView } from '../src/rounds.js';
import { compareRounds } from '../src/compare.js';
import { turnOf } from '../src/rollup.js';
import { handle } from '../src/mcp.js';

let w;
beforeEach(async () => {
  w = await world();
  w.session('s-author', { worktree: 'feature' });
  w.session('s-rev', { worktree: 'feature' });
  w.session('s-cond', { project: '.conduct' });
});
afterEach(() => w.cleanup());

const ok = (res) => { assert.equal(res.ok, true, JSON.stringify(res)); return res; };
const codeOf = (res) => { assert.equal(res.ok, false, 'expected a refusal'); return res.code; };
const author = agent('s-author');
const reviewer = agent('s-rev');
const conductor = agent('s-cond', '.conduct');

/**
 * Four hunks over three files: a1 and a2 (a.js lines 2 and 18), f (f.js) and c (c.js). The review's recipient is s-author.
 * `h` names the ids, `g` proposes groups by hunk names.
 */
async function setup(kind = 'range') {
  const wt = w.addWorktree();
  wt.commit({ 'a.js': editLines({ 2: 'top-edit', 18: 'bottom-edit' }), 'f.js': 'f1\nf2\n', 'c.js': 'c1\nc2\n' });
  const { review } = ok(await reviews.openReview({ project: 'app', worktree: 'feature', recipient: 's-author', kind }, HUMAN));
  const id = review.id;
  const ids = async () => {
    const files = ok(await reviews.diff(id, {})).files;
    const of = (p) => files.find((f) => f.path === p).hunks.map((x) => x.id);
    return { a1: of('a.js')[0], a2: of('a.js')[1], f: of('f.js')[0], c: of('c.js')[0] };
  };
  const h = await ids();
  const spec = (title, ...names) => ({ title, description: `about ${title}`, hunks: names.map((n) => h[n]) });
  const propose = async (specs, actor = author) => ok(await groups.proposeGroups(id, actor, specs));
  const view = async () => ok(await reviews.getReview(id));
  const verdictOf = (hunk) => store.read(id).verdicts[h[hunk]]?.verdict ?? 'pending';
  const groupVerdict = (gid) => store.read(id).groups.find((g) => g.id === gid)?.verdict?.verdict ?? 'pending';
  return { wt, id, h, spec, propose, view, verdictOf, groupVerdict, ids };
}

/** An uncommitted review of the feature worktree, which has a working-tree change. */
async function uncommitted() {
  const wt = w.addWorktree();
  wt.write('a.js', editLines({ 2: 'top-edit' }));
  return ok(await reviews.openReview({ project: 'app', worktree: 'feature', recipient: 's-author', kind: 'uncommitted' }, HUMAN)).review.id;
}

const note = (id, gid, actor = HUMAN, kind = 'comment') => threads.annotate(id, actor, { anchor: { kind: 'group', groupId: gid }, kind, body: 'about the group' });

// ---- Proposal ----

test('a proposal sets ordered groups with title, description and hunks; a hunk may sit in two; guide.ungrouped is exactly the unclaimed hunks', async () => {
  // Invariant: the stored groups are the proposal in order; ungrouped = round hunks no group holds.
  const s = await setup();
  const res = await s.propose([s.spec('first', 'a1', 'f'), s.spec('second', 'f', 'a2')]);
  assert.deepEqual(res.groups.map((g) => [g.id, g.order, g.title, g.verdict]), [['g1', 1, 'first', 'pending'], ['g2', 2, 'second', 'pending']]);
  assert.deepEqual(res.ungrouped, [s.h.c]);
  const { guide } = await s.view();
  assert.deepEqual(guide.groups.map((g) => g.hunks.map((x) => x.id)), [[s.h.a1, s.h.f], [s.h.f, s.h.a2]]);
  assert.equal(guide.groups[0].description, 'about first');
  assert.deepEqual(guide.ungrouped.map((x) => [x.id, x.file]), [[s.h.c, 'c.js']]);
  assert.deepEqual((await s.view()).review.groups, { total: 2, accepted: 0, rejected: 0, pending: 2, ungrouped: 1, guideMe: false });
});

test('every refused proposal leaves the stored review byte-identical', async () => {
  // Invariant: a proposal is atomic: any refusal writes nothing (rev and bytes unchanged).
  const s = await setup();
  await s.propose([s.spec('first', 'a1')]);
  const before = JSON.stringify(store.read(s.id));
  const good = s.spec('x', 'a2');
  const cases = [
    [[{ ...good, hunks: ['nope'] }], 'HUNK_UNKNOWN'],
    [[{ ...good, hunks: [] }], 'GROUP_EMPTY'],
    [[good, { ...good, title: 'again' }], 'INVALID_ARGUMENT'],
    [[{ ...good, extra: 1 }], 'INVALID_ARGUMENT'],
    [[{ ...good, title: ' ' }], 'INVALID_ARGUMENT'],
    [[{ ...good, description: 'x'.repeat(20001) }], 'BODY_TOO_LARGE'],
    [[], 'INVALID_ARGUMENT'],
    [good, 'INVALID_ARGUMENT'],
  ];
  for (const [specs, code] of cases) assert.equal(codeOf(await groups.proposeGroups(s.id, author, specs)), code);
  assert.equal(JSON.stringify(store.read(s.id)), before);
  ok(await reviews.patchReview(s.id, { status: 'closed' }));
  const closed = JSON.stringify(store.read(s.id));
  assert.equal(codeOf(await groups.proposeGroups(s.id, author, [good])), 'REVIEW_CLOSED');
  assert.equal(JSON.stringify(store.read(s.id)), closed);
});

test('an uncommitted review refuses a proposal, a group verdict and a group thread NO_GROUPS, and has no guide', async () => {
  // Invariant: groups exist on range and commit reviews only.
  const id = await uncommitted();
  assert.equal(codeOf(await groups.proposeGroups(id, author, [{ title: 't', description: 'd', hunks: ['x'] }])), 'NO_GROUPS');
  assert.equal(codeOf(await groups.setGroupVerdict(id, 'g1', 'accepted')), 'NO_GROUPS');
  assert.equal(codeOf(await note(id, 'g1')), 'NO_GROUPS');
  const res = ok(await reviews.getReview(id));
  assert.equal(res.guide, null);
  assert.equal(res.review.groups, null);
});

test('re-proposing keeps a same-hunk group with its id, verdict and threads and retires the rest without writing a verdict', async () => {
  // Invariant D3: same hunk set keeps identity; other groups retire (verdict kept as history, threads outdated and repliable); no hunk verdict is written.
  const s = await setup();
  await s.propose([s.spec('first', 'a1', 'a2'), s.spec('second', 'f')]);
  ok(await groups.setGroupVerdict(s.id, 'g1', 'accepted'));
  ok(await groups.setGroupVerdict(s.id, 'g2', 'rejected'));
  const kept = ok(await note(s.id, 'g1')).thread;
  const gone = ok(await note(s.id, 'g2', HUMAN, 'question')).thread;
  const verdictsBefore = store.read(s.id).verdicts;
  const res = await s.propose([s.spec('renamed', 'c'), s.spec('first again', 'a2', 'a1')]);
  assert.deepEqual([res.kept, res.retired, res.threadsOutdated], [1, 1, 1]);
  const stored = store.read(s.id);
  assert.deepEqual(stored.verdicts, verdictsBefore);
  assert.deepEqual(stored.groups.map((g) => [g.id, g.order, g.title, g.verdict?.verdict ?? null]), [['g3', 1, 'renamed', null], ['g1', 2, 'first again', 'accepted']]);
  assert.deepEqual(stored.groups[1].hunkIds, [s.h.a2, s.h.a1]);
  assert.equal(stored.groups[1].description, 'about first again');
  assert.deepEqual(stored.retiredGroups.map((g) => [g.id, g.reason, g.retiredIn, g.verdict.verdict]), [['g2', 'reproposal', 1, 'rejected']]);
  const status = (t) => stored.threads.find((x) => x.id === t.id).status;
  assert.deepEqual([status(kept), status(gone)], ['open', 'outdated']);
  ok(await threads.reply(s.id, HUMAN, gone.id, { body: 'still here' }));
  assert.equal((await s.view()).guide.retired[0].id, 'g2');
});

test('author, reviewer and conductor sessions may all propose, and the proposer is recorded with its role', async () => {
  // Invariant D2: propose_groups has no role gate; the author record freezes the proposer's role.
  const s = await setup();
  for (const [actor, role] of [[author, 'author'], [reviewer, 'reviewer'], [conductor, 'conductor']]) {
    await s.propose([s.spec(role, 'a1')], actor);
    assert.deepEqual(store.read(s.id).groups[0].proposedBy, { kind: 'session', sessionId: actor.sessionId, role });
  }
});

test('a proposal is agent activity: it bumps seq and agentSeq and hands the turn back after a delivered guide', async () => {
  // Invariant: delivered guide -> turn is the agent's; propose_groups (agent activity) returns it to the human.
  const s = await setup();
  const { submission } = ok(await submissions.composeGuide(s.id));
  ok(await submissions.recordResult(s.id, submission.id, { ok: true }));
  assert.equal(turnOf(store.read(s.id)), 'agent');
  const seq = store.read(s.id).seq;
  await s.propose([s.spec('first', 'a1')]);
  const after = store.read(s.id);
  assert.ok(after.seq > seq);
  assert.equal(after.agentSeq, after.seq);
  assert.equal(turnOf(after), 'human');
});

// ---- Group verdicts ----

test('accepting groups accepts exclusive hunks, and a shared hunk once every group holding it is accepted', async () => {
  // Invariant: Accept rule.
  const s = await setup();
  await s.propose([s.spec('one', 'a1', 'a2'), s.spec('two', 'a2', 'f')]);
  const first = ok(await groups.setGroupVerdict(s.id, 'g1', 'accepted'));
  assert.deepEqual(first.hunks, [{ id: s.h.a1, verdict: 'accepted' }]);
  assert.deepEqual([s.verdictOf('a1'), s.verdictOf('a2'), s.verdictOf('f')], ['accepted', 'pending', 'pending']);
  ok(await groups.setGroupVerdict(s.id, 'g2', 'accepted'));
  assert.deepEqual([s.verdictOf('a2'), s.verdictOf('f')], ['accepted', 'accepted']);
});

test('rejecting a group rejects all its hunks, counts them as merge blockers and keeps another group\'s verdict', async () => {
  // Invariant: Reject rule; group actions never change another group's verdict.
  const s = await setup();
  await s.propose([s.spec('one', 'a1', 'a2'), s.spec('two', 'a2', 'f')]);
  ok(await groups.setGroupVerdict(s.id, 'g1', 'accepted'));
  const res = ok(await groups.setGroupVerdict(s.id, 'g2', 'rejected'));
  assert.deepEqual([s.verdictOf('a2'), s.verdictOf('f')], ['rejected', 'rejected']);
  assert.equal(s.groupVerdict('g1'), 'accepted');
  assert.equal(res.review.mergeBlockers, 2);
  assert.deepEqual(res.review.groups, { total: 2, accepted: 1, rejected: 1, pending: 0, ungrouped: 1, guideMe: false });
});

test('direct hunk verdicts clear exactly the groups they contradict and write no other hunk', async () => {
  // Invariant D1: un-accept, reject-one and accept-in-rejected each clear the right groups; nothing else changes.
  const s = await setup();
  await s.propose([s.spec('one', 'a1', 'a2'), s.spec('two', 'f')]);
  ok(await groups.setGroupVerdict(s.id, 'g1', 'accepted'));
  ok(await groups.setGroupVerdict(s.id, 'g2', 'accepted'));

  const unaccept = ok(await reviews.setVerdict(s.id, s.h.a1, 'pending'));
  assert.deepEqual(unaccept.clearedGroups, ['g1']);
  assert.deepEqual([s.groupVerdict('g1'), s.groupVerdict('g2'), s.verdictOf('a2')], ['pending', 'accepted', 'accepted']);

  ok(await groups.setGroupVerdict(s.id, 'g1', 'accepted'));
  assert.deepEqual(ok(await reviews.setVerdict(s.id, s.h.a2, 'rejected')).clearedGroups, ['g1']);
  assert.deepEqual([s.groupVerdict('g1'), s.verdictOf('a1')], ['pending', 'accepted']);

  ok(await groups.setGroupVerdict(s.id, 'g1', 'rejected'));
  assert.deepEqual(ok(await reviews.setVerdict(s.id, s.h.a1, 'accepted')).clearedGroups, ['g1']);
  assert.deepEqual([s.groupVerdict('g1'), s.verdictOf('a1'), s.verdictOf('a2')], ['pending', 'accepted', 'rejected']);

  assert.deepEqual(ok(await reviews.setVerdict(s.id, s.h.a1, 'accepted')).clearedGroups, [], 'no group to contradict');
  assert.equal(s.groupVerdict('g2'), 'accepted');
});

test('a direct verdict while the containing group is pending changes no group, through setVerdict and acceptFile', async () => {
  // Invariant D1: a pending group has no verdict to contradict.
  const s = await setup();
  await s.propose([s.spec('one', 'a1', 'a2')]);
  assert.deepEqual(ok(await reviews.setVerdict(s.id, s.h.a1, 'accepted')).clearedGroups, []);
  const res = ok(await reviews.acceptFile(s.id, 'a.js', [s.h.a1, s.h.a2]));
  assert.deepEqual([res.accepted, res.clearedGroups], [[s.h.a2], []]);
  assert.equal(s.groupVerdict('g1'), 'pending');
});

test('reopening a group sets its hunks pending, and accepting again accepts a hunk whose groups are all accepted', async () => {
  // Invariant D5: Pending group is the undo of Accept and Reject; re-applying a verdict re-runs its hunk writes.
  const s = await setup();
  await s.propose([s.spec('one', 'a1', 'a2'), s.spec('two', 'a2', 'f')]);
  ok(await groups.setGroupVerdict(s.id, 'g1', 'accepted'));
  ok(await groups.setGroupVerdict(s.id, 'g2', 'accepted'));
  const reopen = ok(await groups.setGroupVerdict(s.id, 'g1', 'pending'));
  assert.deepEqual(reopen.hunks.map((x) => x.id).sort(), [s.h.a1, s.h.a2].sort());
  assert.deepEqual([s.groupVerdict('g1'), s.verdictOf('a1'), s.verdictOf('a2'), s.verdictOf('f')], ['pending', 'pending', 'pending', 'accepted']);
  assert.deepEqual(ok(await groups.setGroupVerdict(s.id, 'g1', 'pending')).hunks, [], 'pending on a pending group writes nothing');
  ok(await groups.setGroupVerdict(s.id, 'g1', 'accepted'));
  assert.deepEqual([s.verdictOf('a1'), s.verdictOf('a2')], ['accepted', 'accepted']);
});

test('a group verdict is refused GROUP_UNKNOWN (unknown or retired id), REVIEW_CLOSED or INVALID_ARGUMENT', async () => {
  // Invariant: the refusals of setGroupVerdict, none of which writes.
  const s = await setup();
  await s.propose([s.spec('one', 'a1'), s.spec('two', 'f')]);
  await s.propose([s.spec('two', 'f')]);
  const before = JSON.stringify(store.read(s.id));
  assert.equal(codeOf(await groups.setGroupVerdict(s.id, 'g9', 'accepted')), 'GROUP_UNKNOWN');
  assert.equal(codeOf(await groups.setGroupVerdict(s.id, 'g1', 'accepted')), 'GROUP_UNKNOWN', 'g1 is retired');
  assert.equal(codeOf(await groups.setGroupVerdict(s.id, 'g2', 'maybe')), 'INVALID_ARGUMENT');
  assert.equal(JSON.stringify(store.read(s.id)), before);
  ok(await reviews.patchReview(s.id, { status: 'closed' }));
  assert.equal(codeOf(await groups.setGroupVerdict(s.id, 'g2', 'accepted')), 'REVIEW_CLOSED');
});

test('the response\'s fileSigs equal the diff\'s next sigs, hunks lists the changed ones and the summary counts update', async () => {
  // Invariant: write contract: a client patches its files from fileSigs with no refetch.
  const s = await setup();
  await s.propose([s.spec('one', 'a1', 'f')]);
  const res = ok(await groups.setGroupVerdict(s.id, 'g1', 'rejected'));
  assert.deepEqual(res.hunks, [{ id: s.h.a1, verdict: 'rejected' }, { id: s.h.f, verdict: 'rejected' }]);
  assert.deepEqual(res.fileSigs.map((x) => x.path).sort(), ['a.js', 'f.js']);
  for (const { path, sig } of res.fileSigs) assert.equal(ok(await reviews.diff(s.id, { file: path })).files[0].sig, sig);
  assert.equal(res.review.counts.hunks.rejected, 2);
  assert.equal(res.review.groups.rejected, 1);
  assert.equal(res.guide.groups[0].verdict, 'rejected');
});

test('a seeded random walk over groups sharing hunks never leaves a hunk of a rejected group unrejected', async () => {
  // Invariant I3: every hunk of a rejected group is rejected, after every kind of step.
  const s = await setup();
  let state = 12345;
  const rnd = (n) => { state = (state * 1103515245 + 12345) % 2147483648; return Math.floor((state / 2147483648) * n); };
  const names = ['a1', 'a2', 'f', 'c'];
  const subset = () => { const pick = names.filter(() => rnd(2) === 0); return pick.length ? pick : [names[rnd(4)]]; };
  const proposeRandom = async () => {
    const seen = new Set();
    const specs = [];
    for (let i = 0; i < 3; i++) {
      const pick = subset();
      const key = [...pick].sort().join();
      if (!seen.has(key)) { seen.add(key); specs.push(s.spec(`g${i}`, ...pick)); }
    }
    await s.propose(specs);
  };
  await proposeRandom();
  for (let step = 0; step < 60; step++) {
    const current = store.read(s.id).groups;
    const kind = rnd(5);
    if (kind === 0) await proposeRandom();
    else if (kind === 1) ok(await groups.setGroupVerdict(s.id, current[rnd(current.length)].id, ['pending', 'accepted', 'rejected'][rnd(3)]));
    else if (kind === 2) ok(await groups.setGroupVerdict(s.id, current[rnd(current.length)].id, 'rejected'));
    else if (kind === 3) ok(await reviews.setVerdict(s.id, s.h[names[rnd(4)]], ['pending', 'accepted', 'rejected'][rnd(3)]));
    else ok(await reviews.acceptFile(s.id, 'a.js', [s.h.a1, s.h.a2]));
    const after = store.read(s.id);
    for (const g of after.groups.filter((x) => x.verdict?.verdict === 'rejected')) {
      for (const h of g.hunkIds) assert.equal(after.verdicts[h]?.verdict, 'rejected', `step ${step}: ${g.id} is rejected but ${h} is not`);
    }
  }
});

// ---- Refresh ----

test('a group whose hunks all survive a refresh is carried with its verdict and threads', async () => {
  // Invariant: carry keeps identity, order, text, verdict and open threads; the thread's anchor round advances.
  const s = await setup();
  await s.propose([s.spec('one', 'a1', 'a2'), s.spec('two', 'c')]);
  ok(await groups.setGroupVerdict(s.id, 'g1', 'accepted'));
  const t = ok(await note(s.id, 'g1', HUMAN, 'question')).thread;
  s.wt.commit({ 'b.js': 'x\n' });
  const res = ok(await reviews.refreshReview(s.id, HUMAN));
  assert.deepEqual(res.groups, { kept: 2, dropped: 0 });
  const stored = store.read(s.id);
  assert.deepEqual(stored.groups.map((g) => [g.id, g.order, g.title, g.description, g.verdict?.verdict ?? null]), [['g1', 1, 'one', 'about one', 'accepted'], ['g2', 2, 'two', 'about two', null]]);
  const thread = stored.threads.find((x) => x.id === t.id);
  assert.deepEqual([thread.status, thread.anchor], ['open', { kind: 'group', groupId: 'g1', round: 2 }]);
});

test('a group with a changed hunk is dropped on refresh: retired, its thread outdated and repliable, surviving hunks ungrouped', async () => {
  // Invariant: a dropped group keeps no verdict in force; hunk verdicts carry exactly as without groups (kept / reset).
  const s = await setup();
  await s.propose([s.spec('one', 'a1', 'a2'), s.spec('two', 'f', 'c')]);
  ok(await groups.setGroupVerdict(s.id, 'g2', 'rejected'));
  const t = ok(await note(s.id, 'g2', HUMAN, 'question')).thread;
  s.wt.commit({ 'f.js': 'f1\nchanged\n' });
  const res = ok(await reviews.refreshReview(s.id, HUMAN));
  assert.deepEqual(res.groups, { kept: 1, dropped: 1 });
  assert.equal(res.threads.outdated, 1, 'the group thread counts');
  const stored = store.read(s.id);
  assert.deepEqual(stored.retiredGroups.map((g) => [g.id, g.reason, g.retiredIn]), [['g2', 'refresh', 2]]);
  assert.equal(stored.threads.find((x) => x.id === t.id).status, 'outdated');
  ok(await threads.reply(s.id, HUMAN, t.id, { body: 'still repliable' }));
  const { guide } = await s.view();
  assert.deepEqual(guide.ungrouped.map((x) => x.id).sort(), [s.h.c, (await s.ids()).f].sort());
  assert.equal(stored.verdicts[s.h.c].verdict, 'rejected', 'the surviving hunk keeps its verdict');
  assert.equal(stored.verdicts[s.h.f], undefined, 'the changed hunk resets');
});

test('a carried group sharing a hunk with a dropped one keeps its verdict while the hunk stays pending until the group is accepted again', async () => {
  // Invariant D4: a refresh never accepts code: carried G1 accepted can hold a pending hunk; re-accepting G1 accepts it.
  const s = await setup();
  await s.propose([s.spec('one', 'a1', 'f'), s.spec('two', 'f', 'c')]);
  ok(await groups.setGroupVerdict(s.id, 'g1', 'accepted'));
  assert.equal(s.verdictOf('f'), 'pending');
  s.wt.commit({ 'c.js': 'c1\nchanged\n' });
  ok(await reviews.refreshReview(s.id, HUMAN));
  assert.deepEqual([store.read(s.id).groups.map((g) => g.id), s.groupVerdict('g1'), s.verdictOf('f')], [['g1'], 'accepted', 'pending']);
  const res = ok(await groups.setGroupVerdict(s.id, 'g1', 'accepted'));
  assert.deepEqual(res.hunks, [{ id: s.h.f, verdict: 'accepted' }]);
});

test('Guide me is offered with no groups, after a drop, and while a refresh-added hunk is ungrouped; a proposal clears the latter two', async () => {
  // Invariant: guideMe = no groups, or groups dropped since the last proposal, or a hunk added since then in no group; a proposal resets both counters.
  const s = await setup();
  const view = async () => (await s.view()).guide;
  const offered = async () => (await view()).guideMe;
  const allIds = async () => ok(await reviews.diff(s.id, {})).files.flatMap((f) => f.hunks.map((x) => x.id));
  const idsOf = async (file) => ok(await reviews.diff(s.id, { file })).files[0].hunks.map((x) => x.id);
  assert.deepEqual(await offered(), { offered: true, noGroups: true, droppedGroups: 0, newUngrouped: 0 });
  await s.propose([s.spec('all', 'a1', 'a2', 'f', 'c')]);
  assert.equal((await offered()).offered, false);

  s.wt.commit({ 'n1.js': 'n1\n' });
  ok(await reviews.refreshReview(s.id, HUMAN));
  assert.deepEqual(await offered(), { offered: true, noGroups: false, droppedGroups: 0, newUngrouped: 1 });
  s.wt.commit({ 'n2.js': 'n2\n' });
  ok(await reviews.refreshReview(s.id, HUMAN));
  assert.equal((await offered()).newUngrouped, 2, 'a hunk added two refreshes ago still counts');
  assert.equal((await s.view()).review.groups.guideMe, true);
  const [n1] = await idsOf('n1.js');
  const [n2] = await idsOf('n2.js');
  await s.propose([s.spec('all', 'a1', 'a2', 'f', 'c'), { title: 'new', description: 'd', hunks: [n1, n2] }]);
  assert.deepEqual(await offered(), { offered: false, noGroups: false, droppedGroups: 0, newUngrouped: 0 });

  s.wt.commit({ 'f.js': 'f1\nchanged\n' });
  ok(await reviews.refreshReview(s.id, HUMAN));
  assert.deepEqual(await offered(), { offered: true, noGroups: false, droppedGroups: 1, newUngrouped: 1 });
  await s.propose([{ title: 'everything', description: 'd', hunks: await allIds() }]);
  assert.deepEqual(await offered(), { offered: false, noGroups: false, droppedGroups: 0, newUngrouped: 0 });
  assert.deepEqual(store.read(s.id).sinceProposal, { dropped: 0, newHunkIds: [] });
});

// ---- Group threads ----

test('REST and MCP annotate store a group anchor with no file sig; bad group anchors are refused', async () => {
  // Invariant: a group anchor is {kind, groupId, round}, reads no snapshot and writes no file sig.
  const s = await setup();
  await s.propose([s.spec('one', 'a1')]);
  const rest = ok(await note(s.id, 'g1'));
  assert.equal(rest.fileSig, null);
  const out = (await handle({ tool: 'annotate', arguments: { review: s.id, anchor: 'group', group: 'g1', kind: 'comment', body: 'via mcp' }, caller: { sessionId: 's-rev', project: 'app' }, format: 'json' })).body;
  assert.equal(out.structured.thread.anchor.kind, 'group', JSON.stringify(out));
  assert.deepEqual(store.read(s.id).threads.map((t) => t.anchor), [{ kind: 'group', groupId: 'g1', round: 1 }, { kind: 'group', groupId: 'g1', round: 1 }]);
  assert.deepEqual((await s.view()).guide.threads.map((t) => t.anchor), [{ kind: 'group', groupId: 'g1', round: 1 }, { kind: 'group', groupId: 'g1', round: 1 }]);
  assert.equal(codeOf(await note(s.id, 'g9')), 'GROUP_UNKNOWN');
  assert.equal(codeOf(await threads.annotate(s.id, HUMAN, { anchor: { kind: 'group', groupId: 'g1', file: 'a.js' }, kind: 'comment', body: 'x' })), 'INVALID_ARGUMENT');
});

test('an open group question blocks the merge until resolved', async () => {
  // Invariant: mergeBlockers counts every open question wherever it sits, group threads included.
  const s = await setup();
  await s.propose([s.spec('one', 'a1')]);
  const t = ok(await note(s.id, 'g1', HUMAN, 'question')).thread;
  assert.equal((await s.view()).review.mergeBlockers, 1);
  ok(await threads.setThreadStatus(s.id, t.id, { status: 'resolved' }));
  assert.equal((await s.view()).review.mergeBlockers, 0);
});

test('group threads reach guide.threads, counts, unread and list_threads, and no per-file list, past round or comparison', async () => {
  // Invariant: a group thread is on no file and in no round view; it is counted and listed review-wide.
  const s = await setup();
  await s.propose([s.spec('one', 'a1')]);
  const t = ok(await note(s.id, 'g1', reviewer, 'question')).thread;
  const detail = await s.view();
  assert.deepEqual(detail.guide.threads.map((x) => x.id), [t.id]);
  assert.deepEqual(detail.guide.groups[0].threads, { open: 1, resolved: 0, outdated: 0 });
  assert.equal(detail.guide.groups[0].unread, 1);
  assert.equal(detail.review.counts.threads.open, 1);
  assert.equal(detail.review.unread, 1);
  assert.deepEqual([detail.outdatedThreads, detail.reviewThreads], [[], []]);
  assert.ok(ok(await reviews.diff(s.id, {})).files.every((f) => f.threads.length === 0));
  assert.ok(detail.files.every((f) => f.threads.open === 0));
  const listed = ok(await threads.listThreads(s.id, { status: 'all' }));
  assert.deepEqual(listed.threads.map((x) => x.anchor.kind), ['group']);
  const mcp = (await handle({ tool: 'list_threads', arguments: { review: s.id }, caller: { sessionId: 's-rev', project: 'app' }, format: 'json' })).body;
  assert.equal(mcp.structured.threads[0].anchor.kind, 'group');
  assert.equal(mcp.structured.threads[0].anchor.groupId, 'g1');

  s.wt.commit({ 'b.js': 'x\n' });
  ok(await reviews.refreshReview(s.id, HUMAN));
  const past = ok(await roundView(s.id, 1));
  assert.deepEqual([past.counts, past.outdatedThreads, past.reviewThreads], [{ open: 0, resolved: 0, outdated: 0 }, [], []]);
  assert.ok(past.files.every((f) => f.threads.open === 0));
  const cmp = ok(await compareRounds(s.id, { from: 1, to: 2 }));
  assert.deepEqual([cmp.counts, cmp.unplaced, cmp.reviewThreads], [{ open: 0, resolved: 0, outdated: 0 }, [], []]);
  assert.ok(cmp.files.every((f) => f.threads.length === 0));
});

test('a pending group holding a directly rejected hunk: Pending on it writes nothing', async () => {
  // Invariant D5: Pending on a pending group short-circuits; the hunk stays rejected and rev does not move.
  const s = await setup();
  await s.propose([s.spec('one', 'a1', 'a2')]);
  ok(await reviews.setVerdict(s.id, s.h.a1, 'rejected'));
  const rev = store.read(s.id).rev;
  const res = ok(await groups.setGroupVerdict(s.id, 'g1', 'pending'));
  assert.deepEqual([res.hunks, res.fileSigs], [[], []]);
  assert.equal(store.read(s.id).rev, rev);
  assert.equal(s.verdictOf('a1'), 'rejected');
});

test('a direct accept of a hunk held by an accepted and a rejected group clears only the rejected one', async () => {
  // Invariant D1: only groups whose verdict differs from the new hunk verdict are cleared.
  const s = await setup();
  await s.propose([s.spec('one', 'a1', 'f'), s.spec('two', 'f', 'c')]);
  ok(await groups.setGroupVerdict(s.id, 'g1', 'accepted'));
  ok(await groups.setGroupVerdict(s.id, 'g2', 'rejected'));
  assert.equal(s.verdictOf('f'), 'rejected');
  const res = ok(await reviews.setVerdict(s.id, s.h.f, 'accepted'));
  assert.deepEqual(res.clearedGroups, ['g2']);
  assert.deepEqual([s.groupVerdict('g1'), s.groupVerdict('g2'), s.verdictOf('c')], ['accepted', 'pending', 'rejected']);
});

test('a retired group\'s thread leaves outdatedThreads but stays in guide.threads as outdated', async () => {
  // Invariant: group threads are never in outdatedThreads; guide.threads lists them in any status.
  const s = await setup();
  await s.propose([s.spec('one', 'a1'), s.spec('two', 'f')]);
  const t = ok(await note(s.id, 'g1', HUMAN, 'question')).thread;
  s.wt.commit({ 'a.js': editLines({ 2: 'top-edit-again', 18: 'bottom-edit' }) });
  ok(await reviews.refreshReview(s.id, HUMAN));
  const detail = await s.view();
  assert.deepEqual(detail.guide.retired.map((g) => [g.id, g.reason]), [['g1', 'refresh']]);
  assert.deepEqual(detail.outdatedThreads, []);
  assert.deepEqual(detail.guide.threads.map((x) => [x.id, x.status]), [[t.id, 'outdated']]);
});

test('groups work on a commit review: propose, group verdict and annotate', async () => {
  // Invariant: groups exist on commit reviews as on range reviews.
  const s = await setup('commit');
  await s.propose([s.spec('one', 'a1', 'f')]);
  ok(await groups.setGroupVerdict(s.id, 'g1', 'accepted'));
  assert.deepEqual([s.verdictOf('a1'), s.verdictOf('f')], ['accepted', 'accepted']);
  ok(await note(s.id, 'g1'));
  assert.equal((await s.view()).guide.groups[0].threads.open, 1);
});

test('the guide names its round, each group\'s proposer, and the summary the last submission\'s kind', async () => {
  // Invariant: guide.round is the current round; proposedBy is the proposer's author record; lastSubmission.kind follows the newest submission.
  const s = await setup();
  await s.propose([s.spec('one', 'a1')], reviewer);
  let guide = (await s.view()).guide;
  assert.equal(guide.round, 1);
  assert.deepEqual(guide.groups[0].proposedBy, { kind: 'session', sessionId: 's-rev', role: 'reviewer' });
  s.wt.commit({ 'b.js': 'x\n' });
  ok(await reviews.refreshReview(s.id, HUMAN));
  assert.equal((await s.view()).guide.round, 2);
  assert.equal((await s.view()).review.lastSubmission, null);
  ok(await submissions.composeGuide(s.id));
  assert.equal((await s.view()).review.lastSubmission.kind, 'guide');
  ok(await submissions.composeSubmission(s.id));
  assert.equal((await s.view()).review.lastSubmission.kind, 'round');
});

test('with the diff unreadable, ungrouped is null in the summary and the guide, and the guide prompt omits the ungrouped count', async () => {
  // Invariant: an unreadable snapshot gives ungrouped null (unknown), never 0 or a guess.
  const s = await setup();
  await s.propose([s.spec('one', 'a1')]);
  const known = ok(await submissions.composeGuide(s.id)).submission.text;
  assert.match(known, /\n1 group; 3 hunks in no group\.\n/);
  const bin = fs.mkdtempSync(path.join(path.dirname(w.repo.dir), 'bin-'));
  for (const tool of ['sh', 'ls', 'awk', 'wc', 'cp', 'touch', 'mkdir', 'rm', 'cat', 'realpath', 'readlink']) {
    fs.symlinkSync(execFileSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).trim(), path.join(bin, tool));
  }
  w.cc.state.execEnv = { PATH: bin };
  const detail = await s.view();
  assert.equal(detail.review.snapshotError, 'GIT_UNAVAILABLE');
  assert.equal(detail.review.groups.ungrouped, null);
  assert.equal(detail.guide.ungrouped, null);
  assert.equal(detail.guide.groups[0].hunks[0].file, null);
  const unknown = ok(await submissions.composeGuide(s.id)).submission.text;
  assert.match(unknown, /\n1 group\.\n/);
  assert.ok(!unknown.includes('in no group'));
});

test('a refresh that drops a group without adding any hunk still offers Guide me', async () => {
  // Invariant: droppedGroups > 0 alone offers Guide me (no new hunk is involved).
  const s = await setup();
  await s.propose([s.spec('one', 'a1'), s.spec('two', 'c')]);
  s.wt.commit({ 'c.js': null });
  const res = ok(await reviews.refreshReview(s.id, HUMAN));
  assert.deepEqual([res.groups, res.hunks.new], [{ kept: 1, dropped: 1 }, 0]);
  assert.deepEqual((await s.view()).guide.guideMe, { offered: true, noGroups: false, droppedGroups: 1, newUngrouped: 0 });
});
