import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tempStore } from './_store.js';
import { migrateStore } from '../src/migrate.js';
import { start } from '../server.js';
import * as store from '../src/store.js';

let s;
beforeEach(() => { s = tempStore(); });
afterEach(() => s.cleanup());

// Sorted by id: readdir order is not.
const stored = () => store.list().sort((a, b) => a.id.localeCompare(b.id));
const fileOf = (id) => path.join(s.dir, 'reviews', `${id}.json`);
const HUMAN = { kind: 'human' };
const AGENT = { kind: 'session', sessionId: 's-a', role: 'author' };
const msg = (seq, at, author = HUMAN) => ({ id: `m${seq}`, seq, at, author, body: 'x' });

/** A review file in the shape written before `lastActivityAt` and `agentSeq` existed. */
function seed(id, { messages = [], verdicts = {}, rounds = [], submissions = [], ...extra } = {}) {
  const review = {
    id, project: 'app', worktree: null, status: 'open', createdAt: '2026-01-01T00:00:00.000Z', rev: 3, seq: 9, humanSeq: 0,
    rounds: [{ n: 1, createdAt: '2026-01-01T00:00:00.000Z', submittedAt: null }, ...rounds],
    verdicts, threads: messages.length ? [{ id: 't1', messages }] : [], submissions, ...extra,
  };
  fs.mkdirSync(path.dirname(fileOf(id)), { recursive: true });
  fs.writeFileSync(fileOf(id), JSON.stringify(review, null, 2));
}

test('lastActivityAt is backfilled as the latest of createdAt, messages, verdicts, rounds and submissions', async () => {
  // Invariant: backfill takes the string max over createdAt, every message at, verdict at, round createdAt, submission composedAt and non-null deliveredAt.
  seed('r-000000000a');
  seed('r-000000000b', { messages: [msg(1, '2026-01-03T00:00:00.000Z'), msg(2, '2026-01-02T00:00:00.000Z')] });
  seed('r-000000000c', { messages: [msg(1, '2026-01-02T00:00:00.000Z')], verdicts: { h1: { verdict: 'accepted', seq: 2, at: '2026-01-04T00:00:00.000Z' } } });
  seed('r-000000000d', { verdicts: { h1: { verdict: 'accepted', seq: 2, at: '2026-01-02T00:00:00.000Z' } }, rounds: [{ n: 2, createdAt: '2026-01-05T00:00:00.000Z', submittedAt: null }] });
  seed('r-000000000e', { submissions: [{ id: 's1', seq: 3, status: 'pending', composedAt: '2026-01-06T00:00:00.000Z', deliveredAt: null }] });
  seed('r-000000000f', { submissions: [{ id: 's1', seq: 3, status: 'delivered', composedAt: '2026-01-06T00:00:00.000Z', deliveredAt: '2026-01-07T00:00:00.000Z' }] });
  await migrateStore();
  const got = Object.fromEntries(stored().map((r) => [r.id.slice(-1), r.lastActivityAt.slice(0, 10)]));
  assert.deepEqual(got, { a: '2026-01-01', b: '2026-01-03', c: '2026-01-04', d: '2026-01-05', e: '2026-01-06', f: '2026-01-07' });
});

test('agentSeq is backfilled from agent messages only, 0 without any', async () => {
  // Invariant: backfill sets agentSeq to the max seq of non-human messages, else 0.
  const day = '2026-01-02T00:00:00.000Z';
  seed('r-000000000a', { messages: [msg(1, day, AGENT), msg(4, day, AGENT), msg(6, day)] });
  seed('r-000000000b', { messages: [msg(1, day), msg(2, day)] });
  seed('r-000000000c');
  await migrateStore();
  assert.deepEqual(stored().map((r) => [r.id.slice(-1), r.agentSeq]), [['a', 4], ['b', 0], ['c', 0]]);
});

test('migration is idempotent: a second run, or a review already in the current shape, writes nothing', async () => {
  // Invariant: backfill only fills missing fields, so a migrated or current review is not rewritten (rev unchanged).
  seed('r-000000000a', { messages: [msg(1, '2026-01-02T00:00:00.000Z', AGENT)] });
  seed('r-000000000b', { lastActivityAt: '2026-02-01T00:00:00.000Z', agentSeq: 7 });
  await migrateStore();
  const first = stored();
  assert.deepEqual(first.map((r) => r.rev), [4, 3]);
  assert.deepEqual([first[1].lastActivityAt, first[1].agentSeq], ['2026-02-01T00:00:00.000Z', 7]);
  const bytes = fs.readFileSync(fileOf('r-000000000a'));
  await migrateStore();
  assert.deepEqual(fs.readFileSync(fileOf('r-000000000a')), bytes);
  assert.deepEqual(stored().map((r) => r.rev), [4, 3]);
});

test('anchors and past anchors with no kind become lines anchors', async () => {
  // Invariant: anchorKinds sets kind 'lines' on every thread anchor and pastAnchors entry lacking one, and touches nothing else of them.
  const pos = (round) => ({ file: 'a.js', side: 'new', startLine: 2, endLine: 2, hunkId: null, round, linesHash: 'h', drifted: false });
  seed('r-000000000a', { threads: [
    { id: 't1', messages: [], anchor: { ...pos(2), lines: ['x'] }, pastAnchors: [pos(1)] },
    { id: 't2', messages: [], anchor: pos(1), pastAnchors: [] },
  ] });
  await migrateStore();
  const [review] = stored();
  assert.deepEqual(review.threads[0].anchor, { ...pos(2), lines: ['x'], kind: 'lines' });
  assert.deepEqual(review.threads[0].pastAnchors, [{ ...pos(1), kind: 'lines' }]);
  assert.deepEqual(review.threads[1].anchor, { ...pos(1), kind: 'lines' });
});

test('a review whose anchors all carry a kind, file and review anchors included, is not rewritten, nor is a migrated one', async () => {
  // Invariant: anchorKinds self-checks kind === undefined, so a second run (or a current review) leaves the file byte-identical.
  const kinds = [
    { id: 't1', messages: [], anchor: { kind: 'file', file: 'a.js', round: 2 }, pastAnchors: [{ kind: 'file', file: 'b.js', round: 1 }] },
    { id: 't2', messages: [], anchor: { kind: 'review', round: 1 }, pastAnchors: [] },
  ];
  seed('r-000000000a', { lastActivityAt: '2026-02-01T00:00:00.000Z', agentSeq: 0, threads: kinds });
  seed('r-000000000b', { threads: [{ id: 't1', messages: [], anchor: { file: 'a.js', side: 'new', startLine: 1, endLine: 1, round: 1 }, pastAnchors: [] }] });
  const current = fs.readFileSync(fileOf('r-000000000a'));
  await migrateStore();
  assert.deepEqual(fs.readFileSync(fileOf('r-000000000a')), current);
  const migrated = fs.readFileSync(fileOf('r-000000000b'));
  await migrateStore();
  assert.deepEqual(fs.readFileSync(fileOf('r-000000000b')), migrated);
  assert.equal(stored()[1].threads[0].anchor.kind, 'lines');
});

test('an unparsable file is logged and left byte-identical; the other reviews are migrated', async (t) => {
  // Invariant: a file mutate cannot read is skipped through logSkipped ('not migrated'), never rewritten or removed, and does not stop the run.
  const errors = t.mock.method(console, 'error', () => {});
  seed('r-000000000a');
  fs.writeFileSync(fileOf('r-000000000b'), '{ broken');
  seed('r-000000000c');
  await migrateStore();
  assert.equal(fs.readFileSync(fileOf('r-000000000b'), 'utf8'), '{ broken');
  assert.ok(errors.mock.calls.some((c) => /review r-000000000b not migrated/.test(c.arguments[0])), 'logged');
  assert.deepEqual(stored().map((r) => [r.id, typeof r.lastActivityAt]), [['r-000000000a', 'string'], ['r-000000000c', 'string']]);
});

test('an unconfigured store is a silent no-op', async (t) => {
  // Invariant: STORE_UNCONFIGURED from storeRoot is swallowed, so startup never fails on it.
  const saved = { store: process.env.CODE_REVIEW_STORE, root: process.env.PROJECTS_ROOT };
  delete process.env.CODE_REVIEW_STORE;
  delete process.env.PROJECTS_ROOT;
  t.after(() => {
    process.env.CODE_REVIEW_STORE = saved.store;
    if (saved.root !== undefined) process.env.PROJECTS_ROOT = saved.root;
  });
  await migrateStore();
});

test('start() migrates the store before it serves', async (t) => {
  // Invariant: server.js start() awaits migrateStore before listen.
  seed('r-000000000a', { messages: [msg(2, '2026-01-02T00:00:00.000Z', AGENT)] });
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-migrate-dist-'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html>');
  const server = await start({ port: 0, distDir: dist });
  t.after(() => { server.closeAllConnections(); server.close(); fs.rmSync(dist, { recursive: true, force: true }); });
  const review = JSON.parse(fs.readFileSync(fileOf('r-000000000a'), 'utf8'));
  assert.deepEqual([review.lastActivityAt, review.agentSeq], ['2026-01-02T00:00:00.000Z', 2]);
});
