import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { world, HUMAN, agent, editLines } from './_world.js';
import * as reviews from '../src/reviews.js';
import * as threads from '../src/threads.js';
import * as submissions from '../src/submissions.js';

let w;
beforeEach(async () => { w = await world(); w.session('s-author', { worktree: 'feature' }); });
afterEach(() => w.cleanup());

const ok = (res) => { assert.equal(res.ok, true, JSON.stringify(res)); return res; };
const codeOf = (res) => { assert.equal(res.ok, false, 'expected a refusal'); return res.code; };
const at = (file, startLine, endLine = startLine) => ({ file, side: 'new', startLine, endLine });
const author = agent('s-author');

async function twoHunks(args = { recipient: 's-author' }) {
  const wt = w.addWorktree();
  wt.commit({ 'a.js': editLines({ 2: 'top-edit', 18: 'bottom-edit' }) });
  const { review } = ok(await reviews.openReview({ project: 'app', worktree: 'feature', ...args }, HUMAN));
  const [h1, h2] = ok(await reviews.diff(review.id, {})).files[0].hunks;
  return { wt, review, h1, h2 };
}
const deliver = async (id) => {
  const { submission } = ok(await submissions.composeSubmission(id));
  ok(await submissions.recordResult(id, submission.id, { ok: true }));
  return submission;
};

test('the prompt names the review and round, lists rejected hunks and threads with new human activity, and omits accepted hunks', async () => {
  const { review, h1, h2 } = await twoHunks();
  ok(await reviews.setVerdict(review.id, h1.id, 'accepted'));
  ok(await reviews.setVerdict(review.id, h2.id, 'rejected'));
  ok(await threads.annotate(review.id, HUMAN, { anchor: at('a.js', 2), kind: 'question', body: 'why rename this?\nmore detail' }));
  const { submission } = ok(await submissions.composeSubmission(review.id));
  assert.equal(submission.recipient, 's-author');
  assert.equal(submission.round, 1);
  assert.equal(submission.status, 'pending');
  assert.ok(submission.text.includes(review.id));
  assert.match(submission.text, /round 1/);
  assert.ok(submission.text.includes(`h:${h2.id}`), 'rejected hunk');
  assert.ok(!submission.text.includes(`h:${h1.id}`), 'accepted hunk');
  assert.match(submission.text, /\[t1\] question · a\.js#L2: why rename this\?/);
  assert.ok(!submission.text.includes('more detail'), 'only the first line of the message');
});

test('a later prompt excludes what an earlier delivered one already carried', async () => {
  const { review, h2 } = await twoHunks();
  ok(await reviews.setVerdict(review.id, h2.id, 'rejected'));
  ok(await threads.annotate(review.id, HUMAN, { anchor: at('a.js', 2), kind: 'comment', body: 'first note' }));
  ok(await threads.annotate(review.id, HUMAN, { anchor: at('a.js', 18), kind: 'comment', body: 'untouched note' }));
  await deliver(review.id);
  ok(await threads.reply(review.id, HUMAN, 't1', { body: 'second note' }));
  const { submission } = ok(await submissions.composeSubmission(review.id));
  assert.match(submission.text, /\[t1\].*second note/);
  assert.ok(!submission.text.includes('[t2]'), 'untouched thread');
  assert.ok(!submission.text.includes(`h:${h2.id}`), 'already delivered rejection');
});

test('a human status change or disposition counts as activity; an agent reply alone does not', async () => {
  const { review } = await twoHunks();
  const f = ok(await threads.annotate(review.id, agent('s-rev'), { anchor: at('a.js', 2), kind: 'finding', severity: 'minor', body: 'nit' })).thread;
  await deliver(review.id);
  ok(await threads.reply(review.id, author, f.id, { body: 'on it' }));
  assert.equal(codeOf(await submissions.composeSubmission(review.id)), 'NOTHING_TO_SUBMIT');
  ok(await threads.setThreadStatus(review.id, f.id, { status: 'resolved', disposition: 'dismissed' }));
  const { submission } = ok(await submissions.composeSubmission(review.id));
  assert.match(submission.text, /\[t1\] finding/);
  assert.match(submission.text, /dismissed/);
});

test('a first submission is always allowed; with nothing new after delivery it is refused NOTHING_TO_SUBMIT', async () => {
  const { review } = await twoHunks();
  await deliver(review.id);
  assert.equal(codeOf(await submissions.composeSubmission(review.id)), 'NOTHING_TO_SUBMIT');
});

test('an uncommitted review asks its reviewer to review the changed files, even with no threads yet', async () => {
  const wt = w.addWorktree();
  wt.write('a.js', editLines({ 2: 'X' }));
  const { review } = ok(await reviews.openReview({ project: 'app', worktree: 'feature', kind: 'uncommitted', recipient: 's-author' }, HUMAN));
  const { submission } = ok(await submissions.composeSubmission(review.id));
  assert.match(submission.text, /uncommitted/);
  assert.ok(submission.text.includes('a.js'));
  assert.ok(submission.text.includes(review.id));
  assert.match(submission.text, /reviewer/);
});

test('without a recipient a submission is refused NO_RECIPIENT; a closed review REVIEW_CLOSED', async () => {
  const { review } = await twoHunks({});
  ok(await reviews.patchReview(review.id, { recipient: null }));
  assert.equal(codeOf(await submissions.composeSubmission(review.id)), 'NO_RECIPIENT');
  ok(await reviews.patchReview(review.id, { recipient: 's-author' }));
  ok(await reviews.patchReview(review.id, { status: 'closed' }));
  assert.equal(codeOf(await submissions.composeSubmission(review.id)), 'REVIEW_CLOSED');
});

test('a failed delivery stays re-sendable, a later ok delivers it, and a delivered one cannot be reported again', async () => {
  const { review } = await twoHunks();
  const { submission } = ok(await submissions.composeSubmission(review.id));
  const failed = ok(await submissions.recordResult(review.id, submission.id, { ok: false, code: 'SESSION_NOT_LIVE' })).submission;
  assert.deepEqual([failed.status, failed.code], ['failed', 'SESSION_NOT_LIVE']);
  assert.equal(ok(await reviews.getReview(review.id)).review.lastSubmission.status, 'failed');
  const delivered = ok(await submissions.recordResult(review.id, submission.id, { ok: true })).submission;
  assert.equal(delivered.status, 'delivered');
  assert.equal(codeOf(await submissions.recordResult(review.id, submission.id, { ok: true })), 'SUBMISSION_NOT_PENDING');
  assert.equal(codeOf(await submissions.recordResult(review.id, 's99', { ok: true })), 'SUBMISSION_UNKNOWN');
});

test('result codes are the bridge\'s, HOST_ERROR included; anything else is refused', async () => {
  const { review } = await twoHunks();
  const { submission } = ok(await submissions.composeSubmission(review.id));
  for (const code of ['INVALID_ARGUMENT', 'SESSION_UNKNOWN', 'SESSION_NOT_LIVE', 'SESSION_NOT_READY', 'SEND_FAILED', 'LOOKUP_FAILED', 'HOST_ERROR']) {
    assert.equal(ok(await submissions.recordResult(review.id, submission.id, { ok: false, code })).submission.code, code);
  }
  assert.equal(codeOf(await submissions.recordResult(review.id, submission.id, { ok: false, code: 'WAT' })), 'INVALID_ARGUMENT');
  assert.equal(codeOf(await submissions.recordResult(review.id, submission.id, {})), 'INVALID_ARGUMENT');
});

test('composing again supersedes a pending or failed submission', async () => {
  const { review } = await twoHunks();
  const a = ok(await submissions.composeSubmission(review.id)).submission;
  const b = ok(await submissions.composeSubmission(review.id)).submission;
  const subs = ok(await reviews.getReview(review.id)).submissions;
  assert.deepEqual(subs.map((s) => [s.id, s.status]), [[a.id, 'superseded'], [b.id, 'pending']]);
  assert.equal(codeOf(await submissions.recordResult(review.id, a.id, { ok: true })), 'SUBMISSION_NOT_PENDING');
});

test('delivery stamps the round\'s submittedAt, once', async () => {
  const { review } = await twoHunks();
  assert.equal(ok(await reviews.getReview(review.id)).rounds[0].submittedAt, null);
  await deliver(review.id);
  const stamp = ok(await reviews.getReview(review.id)).rounds[0].submittedAt;
  assert.ok(stamp);
  ok(await threads.annotate(review.id, HUMAN, { anchor: at('a.js', 2), kind: 'comment', body: 'again' }));
  await deliver(review.id);
  assert.equal(ok(await reviews.getReview(review.id)).rounds[0].submittedAt, stamp);
});
