import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { world, HUMAN, agent, editLines } from './_world.js';
import * as reviews from '../src/reviews.js';
import * as threads from '../src/threads.js';

let w;
beforeEach(async () => { w = await world(); });
afterEach(() => w.cleanup());

const open = (args = {}, actor = HUMAN) => reviews.openReview({ project: 'app', worktree: 'feature', ...args }, actor);
const ok = (res) => { assert.equal(res.ok, true, JSON.stringify(res)); return res; };
const codeOf = (res) => { assert.equal(res.ok, false, 'expected a refusal'); return res.code; };

test('a range with no base uses the checkout\'s own fork point', async () => {
  const wt = w.addWorktree();
  wt.commit({ 'f.js': 'x\n' });
  const { review, reused } = ok(await open());
  assert.equal(reused, false);
  assert.deepEqual(review.target, { base: 'main' });
  assert.equal(review.label, 'main...br-feature');
  assert.equal(review.round, 1);
  assert.equal(review.counts.files, 1);
  assert.equal(review.seenByHuman, true);
});

test('a range on a main checkout without a base is refused BASE_REQUIRED', async () => {
  assert.equal(codeOf(await reviews.openReview({ project: 'app', worktree: null, kind: 'range' }, HUMAN)), 'BASE_REQUIRED');
});

test('opening an identical open target reuses the review; a closed one is not reused', async () => {
  w.addWorktree().commit({ 'f.js': 'x\n' });
  const first = ok(await open());
  const again = ok(await open({ base: 'main' }));
  assert.equal(again.reused, true);
  assert.equal(again.review.id, first.review.id);
  ok(await reviews.patchReview(first.review.id, { status: 'closed' }));
  assert.notEqual(ok(await open()).review.id, first.review.id);
});

test('commit kind defaults to HEAD, resolves to a full sha, reuses, and refuses refresh as immutable', async () => {
  const wt = w.addWorktree();
  const sha = wt.commit({ 'f.js': 'x\n' });
  const { review } = ok(await open({ kind: 'commit' }));
  assert.deepEqual(review.target, { sha });
  assert.equal(review.label, `commit ${sha.slice(0, 7)}`);
  assert.equal(ok(await open({ kind: 'commit', sha: 'HEAD' })).review.id, review.id);
  assert.equal(codeOf(await reviews.refreshReview(review.id)), 'IMMUTABLE_TARGET');
});

test('recipient default: explicit, else the calling session, else the single attached live session, else none', async () => {
  w.addWorktree().commit({ 'f.js': 'x\n' });
  w.session('s-a', { worktree: 'feature' });
  w.session('s-b', { worktree: 'feature' });
  w.session('s-dead', { worktree: 'feature', status: 'exited' });
  const fresh = async (args, actor) => {
    const { review } = ok(await open(args, actor));
    ok(await reviews.patchReview(review.id, { status: 'closed' }));
    return review;
  };
  assert.equal((await fresh({ recipient: 's-a' }, agent('s-b'))).recipient, 's-a');
  assert.equal((await fresh({}, agent('s-b'))).recipient, 's-b');
  assert.equal((await fresh({}, HUMAN)).recipient, null, 'two live attached sessions are ambiguous');
  w.cc.state.instances = w.cc.state.instances.filter((i) => i.sessionId !== 's-b');
  assert.equal((await fresh({}, HUMAN)).recipient, 's-a');
  assert.equal(codeOf(await open({ recipient: 'ghost' })), 'RECIPIENT_UNKNOWN');
});

test('verdicts: refused on uncommitted, unknown hunks and bad values; accepted ones count; pending clears', async () => {
  const wt = w.addWorktree();
  wt.commit({ 'a.js': editLines({ 2: 'X' }) });
  const { review } = ok(await open());
  const detail = ok(await reviews.getReview(review.id));
  const diff = ok(await reviews.diff(review.id, {}));
  const hunkId = diff.files[0].hunks[0].id;
  assert.equal(detail.review.counts.hunks.pending, 1);
  assert.equal(codeOf(await reviews.setVerdict(review.id, 'nope', 'accepted')), 'HUNK_UNKNOWN');
  assert.equal(codeOf(await reviews.setVerdict(review.id, hunkId, 'maybe')), 'INVALID_ARGUMENT');
  const set = ok(await reviews.setVerdict(review.id, hunkId, 'rejected'));
  assert.equal(set.review.counts.hunks.rejected, 1);
  assert.equal(set.review.mergeBlockers, 1);
  assert.equal(ok(await reviews.setVerdict(review.id, hunkId, 'pending')).review.counts.hunks.pending, 1);
  wt.write('u.txt', 'u\n');
  const unc = ok(await open({ kind: 'uncommitted' })).review;
  assert.deepEqual(unc.counts.hunks, { total: 1 });
  assert.equal(codeOf(await reviews.setVerdict(unc.id, hunkId, 'accepted')), 'NO_VERDICTS');
});

async function twoHunkReview() {
  const wt = w.addWorktree();
  wt.commit({ 'a.js': editLines({ 2: 'top-edit', 18: 'bottom-edit' }) });
  const { review } = ok(await open());
  const hunks = ok(await reviews.diff(review.id, {})).files[0].hunks;
  assert.equal(hunks.length, 2);
  for (const h of hunks) ok(await reviews.setVerdict(review.id, h.id, 'accepted'));
  return { wt, review, hunks };
}

test('refresh: an untouched hunk keeps its verdict, a changed hunk resets, and the thread follows its lines; new round pins the new HEAD', async () => {
  const { wt, review, hunks } = await twoHunkReview();
  const t = ok(await threads.annotate(review.id, HUMAN, { anchor: { file: 'a.js', side: 'new', startLine: 18, endLine: 18 }, kind: 'comment', body: 'hm' }));
  const head = wt.commit({ 'a.js': ['ins1', 'ins2', ...editLines({ 2: 'top-edit-2', 18: 'bottom-edit' }).split('\n')].join('\n') });
  assert.equal(ok(await reviews.getReview(review.id)).review.headMoved, true);
  const res = ok(await reviews.refreshReview(review.id));
  assert.equal(res.unchanged, false);
  assert.equal(res.round, 2);
  assert.deepEqual(res.hunks, { kept: 1, reset: 1, new: 1 });
  assert.equal(res.threads.moved, 1);
  const after = ok(await reviews.getReview(review.id));
  assert.equal(after.review.headSha, head);
  assert.equal(after.review.headMoved, false);
  assert.equal(after.review.counts.hunks.accepted, 1);
  assert.equal(after.review.counts.hunks.pending, 1);
  const thread = ok(await reviews.diff(review.id, { file: 'a.js' })).files[0].threads.find((x) => x.id === t.thread.id);
  assert.equal(thread.anchor.startLine, 20);
  assert.ok(hunks.some((h) => h.id));
});

test('refresh: a thread on edited lines with intact surroundings drifts; one whose surroundings changed goes outdated', async () => {
  const { wt, review } = await twoHunkReview();
  const mk = async (line) => ok(await threads.annotate(review.id, HUMAN, { anchor: { file: 'a.js', side: 'new', startLine: line, endLine: line }, kind: 'comment', body: 'x' })).thread.id;
  const onEdit = await mk(2);
  const inContext = await mk(10);
  wt.commit({ 'a.js': editLines({ 2: 'top-edit-again', 18: 'bottom-edit', 7: 'q7', 8: 'q8', 9: 'q9', 10: 'q10', 11: 'q11', 12: 'q12', 13: 'q13' }) });
  const res = ok(await reviews.refreshReview(review.id));
  assert.equal(res.threads.drifted, 1);
  assert.equal(res.threads.outdated, 1);
  const detail = ok(await reviews.getReview(review.id));
  assert.deepEqual(detail.outdatedThreads.map((x) => x.id), [inContext]);
  const kept = ok(await reviews.diff(review.id, {})).files[0].threads.find((x) => x.id === onEdit);
  assert.equal(kept.anchor.drifted, true);
});

test('refresh with an unchanged HEAD reports unchanged and does not add a round', async () => {
  const { review } = await twoHunkReview();
  const res = ok(await reviews.refreshReview(review.id));
  assert.deepEqual([res.unchanged, res.round], [true, 1]);
  assert.equal(ok(await reviews.getReview(review.id)).rounds.length, 1);
});

test('a range review whose worktree is gone stays readable; refresh is refused CHECKOUT_GONE; threads still work', async () => {
  const { wt, review } = await twoHunkReview();
  wt.destroy();
  const detail = ok(await reviews.getReview(review.id));
  assert.equal(detail.review.checkoutGone, true);
  assert.equal(detail.files.length, 1);
  assert.equal(codeOf(await reviews.refreshReview(review.id)), 'CHECKOUT_GONE');
  ok(await threads.annotate(review.id, HUMAN, { anchor: { file: 'a.js', side: 'new', startLine: 2, endLine: 2 }, kind: 'comment', body: 'still here' }));
});

test('a closed review refuses verdicts, threads, refresh; reopening restores them', async () => {
  const { review, hunks } = await twoHunkReview();
  ok(await reviews.patchReview(review.id, { status: 'closed' }));
  assert.equal(codeOf(await reviews.setVerdict(review.id, hunks[0].id, 'rejected')), 'REVIEW_CLOSED');
  assert.equal(codeOf(await reviews.refreshReview(review.id)), 'REVIEW_CLOSED');
  assert.equal(codeOf(await threads.annotate(review.id, HUMAN, { anchor: { file: 'a.js', side: 'new', startLine: 2, endLine: 2 }, kind: 'comment', body: 'x' })), 'REVIEW_CLOSED');
  ok(await reviews.patchReview(review.id, { status: 'open' }));
  ok(await reviews.setVerdict(review.id, hunks[0].id, 'rejected'));
});

test('a dirty checkout is flagged on range reviews', async () => {
  const wt = w.addWorktree();
  wt.commit({ 'f.js': 'x\n' });
  const { review } = ok(await open());
  assert.equal(review.dirty, false);
  wt.write('scratch.txt', 's\n');
  assert.equal(ok(await reviews.getReview(review.id)).review.dirty, true);
});

test('list filters by project, worktree and status and returns newest first; delete removes; patch validates the recipient', async () => {
  w.addWorktree('one').commit({ 'f.js': 'x\n' });
  w.addWorktree('two').commit({ 'g.js': 'y\n' });
  const r1 = ok(await open({ worktree: 'one' })).review;
  const r2 = ok(await open({ worktree: 'two' })).review;
  assert.deepEqual(ok(await reviews.listReviews({ project: 'app' })).reviews.map((r) => r.id), [r2.id, r1.id]);
  assert.deepEqual(ok(await reviews.listReviews({ project: 'app', worktree: 'one' })).reviews.map((r) => r.id), [r1.id]);
  assert.deepEqual(ok(await reviews.listReviews({ project: 'app', status: 'closed' })).reviews, []);
  assert.equal(codeOf(await reviews.patchReview(r1.id, { recipient: 'ghost' })), 'RECIPIENT_UNKNOWN');
  assert.equal(ok(await reviews.patchReview(r1.id, { title: 'T' })).review.title, 'T');
  ok(await reviews.deleteReview(r1.id));
  assert.equal(codeOf(await reviews.getReview(r1.id)), 'REVIEW_UNKNOWN');
});

test('the commit filter shows one commit read-only; a commit outside the range is refused', async () => {
  const wt = w.addWorktree();
  const c1 = wt.commit({ 'f.js': 'x\n' }, 'first');
  wt.commit({ 'g.js': 'y\n' }, 'second');
  const { review } = ok(await open());
  const commits = ok(await reviews.commits(review.id)).commits;
  assert.deepEqual(commits.map((c) => c.subject), ['second', 'first']);
  const view = ok(await reviews.diff(review.id, { commit: c1 }));
  assert.equal(view.readOnly, true);
  assert.deepEqual(view.files.map((f) => f.path), ['f.js']);
  assert.ok(view.files[0].hunks.every((h) => h.verdict === null));
  assert.equal(codeOf(await reviews.diff(review.id, { commit: w.repo.git('rev-parse', 'main') })), 'COMMIT_NOT_IN_RANGE');
});

test('file lines: a window of one side; out-of-range and absent files are refused', async () => {
  w.addWorktree().commit({ 'a.js': editLines({ 2: 'X' }) });
  const { review } = ok(await open());
  const win = ok(await reviews.fileLines(review.id, { path: 'a.js', side: 'new', start: 1, end: 3 }));
  assert.deepEqual(win.lines, [{ n: 1, text: 'l1' }, { n: 2, text: 'X' }, { n: 3, text: 'l3' }]);
  assert.equal(win.total, 20);
  assert.equal((ok(await reviews.fileLines(review.id, { path: 'a.js', side: 'old', start: 2, end: 2 }))).lines[0].text, 'l2');
  assert.equal(codeOf(await reviews.fileLines(review.id, { path: 'a.js', side: 'new', start: 5, end: 99 })), 'LINE_OUT_OF_RANGE');
  assert.equal(codeOf(await reviews.fileLines(review.id, { path: 'zzz.js', side: 'new' })), 'FILE_NOT_IN_DIFF');
});

test('worktree "" is the main checkout, like an omitted one', async () => {
  const { review } = ok(await reviews.openReview({ project: 'app', worktree: '', kind: 'uncommitted' }, HUMAN));
  assert.equal(review.worktree, null);
  assert.equal(ok(await reviews.openReview({ project: 'app', kind: 'uncommitted' }, HUMAN)).reused, true);
});

test('refresh re-rounds a re-anchored thread: its anchor round becomes the new round', async () => {
  const { wt, review } = await twoHunkReview();
  const t = ok(await threads.annotate(review.id, HUMAN, { anchor: { file: 'a.js', side: 'new', startLine: 18, endLine: 18 }, kind: 'comment', body: 'x' })).thread;
  assert.equal(t.anchor.round, 1);
  wt.commit({ 'a.js': ['ins1', ...editLines({ 2: 'top-edit', 18: 'bottom-edit' }).split('\n')].join('\n') });
  ok(await reviews.refreshReview(review.id));
  const after = ok(await reviews.diff(review.id, {})).files[0].threads.find((x) => x.id === t.id);
  assert.equal(after.anchor.round, 2);
});

test('drift is not sticky: it is counted each time it happens and cleared once the exact lines are found again', async () => {
  const { wt, review } = await twoHunkReview();
  const t = ok(await threads.annotate(review.id, HUMAN, { anchor: { file: 'a.js', side: 'new', startLine: 2, endLine: 2 }, kind: 'comment', body: 'x' })).thread;
  const anchorOf = async () => ok(await reviews.diff(review.id, {})).files[0].threads.find((x) => x.id === t.id).anchor;
  wt.commit({ 'a.js': editLines({ 2: 'drift-1', 18: 'bottom-edit' }) });
  assert.equal(ok(await reviews.refreshReview(review.id)).threads.drifted, 1);
  assert.equal((await anchorOf()).drifted, true);
  wt.commit({ 'a.js': editLines({ 2: 'drift-2', 18: 'bottom-edit' }) });
  assert.equal(ok(await reviews.refreshReview(review.id)).threads.drifted, 1, 'a second drift is counted too');
  wt.commit({ 'b.js': 'unrelated\n' });
  const calm = ok(await reviews.refreshReview(review.id));
  assert.deepEqual([calm.threads.drifted, calm.threads.moved, calm.threads.outdated], [0, 0, 0]);
  assert.equal((await anchorOf()).drifted, false);
});

test('a reverted edit does not resurrect the verdict its hunk had before the edit', async () => {
  const { wt, review, hunks } = await twoHunkReview();
  wt.commit({ 'a.js': editLines({ 2: 'changed', 18: 'bottom-edit' }) });
  assert.equal(ok(await reviews.refreshReview(review.id)).hunks.reset, 1);
  wt.commit({ 'a.js': editLines({ 2: 'top-edit', 18: 'bottom-edit' }) });
  ok(await reviews.refreshReview(review.id));
  const verdicts = Object.fromEntries(ok(await reviews.diff(review.id, {})).files[0].hunks.map((h) => [h.id, h.verdict]));
  assert.equal(verdicts[hunks[0].id], 'pending');
  assert.equal(verdicts[hunks[1].id], 'accepted');
});

test('refresh is not unchanged when HEAD is the same but the merge-base moved', async () => {
  const wt = w.addWorktree();
  const c1 = wt.commit({ 'f.js': '1\n' });
  wt.commit({ 'g.js': '2\n' });
  const { review } = await open().then(ok);
  w.repo.git('update-ref', 'refs/heads/main', c1);
  const res = ok(await reviews.refreshReview(review.id));
  assert.deepEqual([res.unchanged, res.round], [false, 2]);
  assert.equal(ok(await reviews.getReview(review.id)).review.baseSha, c1);
});

test('a binary file cannot be read as lines', async () => {
  w.addWorktree().commit({ 'img.bin': Buffer.from([0, 1, 2, 0, 255, 10, 65]) });
  const { review } = await open().then(ok);
  assert.equal(codeOf(await reviews.fileLines(review.id, { path: 'img.bin', side: 'new' })), 'BINARY_FILE');
});

test('the commit filter is refused on commit and uncommitted reviews; uncommitted hunks carry no verdict', async () => {
  const wt = w.addWorktree();
  const sha = wt.commit({ 'f.js': 'x\n' });
  const commit = ok(await open({ kind: 'commit' })).review;
  assert.equal(codeOf(await reviews.diff(commit.id, { commit: sha })), 'INVALID_ARGUMENT');
  wt.write('f.js', 'y\n');
  const unc = ok(await open({ kind: 'uncommitted' })).review;
  assert.equal(codeOf(await reviews.diff(unc.id, { commit: sha })), 'INVALID_ARGUMENT');
  const hunks = ok(await reviews.diff(unc.id, {})).files.flatMap((f) => f.hunks);
  assert.ok(hunks.length > 0 && hunks.every((h) => h.verdict === null));
});

test('a file git treats as binary through .gitattributes cannot be read as lines either, matching annotate', async () => {
  w.addWorktree().commit({ '.gitattributes': '*.bin -diff\n', 'x.bin': 'plain text\nmore\n' });
  const { review } = await open().then(ok);
  assert.equal(ok(await reviews.getReview(review.id)).files.find((f) => f.path === 'x.bin').binary, true);
  assert.equal(codeOf(await reviews.fileLines(review.id, { path: 'x.bin', side: 'new' })), 'BINARY_FILE');
  assert.equal(codeOf(await threads.annotate(review.id, HUMAN, { anchor: { file: 'x.bin', startLine: 1 }, kind: 'comment', body: 'x' })), 'BINARY_FILE');
});

test('an unchanged file outside the diff falls back to a NUL scan to refuse binary reads', async () => {
  w.repo.commit({ 'blob.bin': Buffer.from([0, 1, 2, 0, 255, 10]) });
  w.addWorktree().commit({ 'f.js': 'x\n' });
  const { review } = await open().then(ok);
  assert.equal(codeOf(await reviews.fileLines(review.id, { path: 'blob.bin', side: 'new' })), 'BINARY_FILE');
});
