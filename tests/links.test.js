import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { reviewLink, threadLink } from '../src/links.js';
import { parseRoute, toSearch } from '../frontend/src/lib/route.ts';

const manifest = JSON.parse(fs.readFileSync(new URL('../conductor.plugin.json', import.meta.url), 'utf8'));
const PREFIX = `#plugin/${manifest.id}/`;
const built = [];

const route = (link) => {
  built.push(link);
  assert.ok(link.startsWith(`${PREFIX}?`), link);
  return parseRoute(link.slice(PREFIX.length));
};
const rv = { id: 'r-1', project: 'app', worktree: 'feature' };
const thread = (status, anchor) => ({ id: 't-7', status, anchor: { file: 'a.js', side: 'new', startLine: 3, endLine: 3, round: 2, ...anchor } });

test('a review link opens that review in its checkout', () => {
  // Invariant: project, worktree and review survive parseRoute; a main checkout has no worktree key.
  assert.deepEqual(route(reviewLink(rv)), { project: 'app', worktree: 'feature', review: 'r-1' });
  assert.deepEqual(route(reviewLink({ ...rv, worktree: null })), { project: 'app', review: 'r-1' });
});

test('the link prefix is the manifest id', () => {
  // Invariant: links address the plugin by the id cc reads from conductor.plugin.json.
  assert.ok(reviewLink(rv).startsWith(`#plugin/${manifest.id}/?`));
});

test('a live thread opens its file at the thread, with no lines=', () => {
  // Invariant: open and resolved threads route to file/side/thread exactly as ThreadCard's Focus does.
  for (const [status, side] of [['open', 'new'], ['resolved', 'old']]) {
    assert.deepEqual(route(threadLink(rv, thread(status, { side, startLine: 3, endLine: 5 }))),
      { project: 'app', worktree: 'feature', review: 'r-1', file: 'a.js', side, thread: 't-7' });
  }
});

test('an outdated new-side thread opens comparison R..R+1 on the old side at its last lines', () => {
  // Invariant: outdated + new side → compare=R..R+1, side=old, lines; a single line is "3", a range "3-5".
  assert.deepEqual(route(threadLink(rv, thread('outdated', { endLine: 5 }))),
    { project: 'app', worktree: 'feature', review: 'r-1', file: 'a.js', side: 'old', lines: '3-5', thread: 't-7', compare: '2..3' });
  assert.equal(route(threadLink(rv, thread('outdated', {}))).lines, '3');
});

test('an outdated old-side thread opens round view R', () => {
  // Invariant: outdated + old side → round=R, side=old, lines, and no compare.
  const r = route(threadLink(rv, thread('outdated', { side: 'old', endLine: 4 })));
  assert.deepEqual(r, { project: 'app', worktree: 'feature', review: 'r-1', file: 'a.js', side: 'old', lines: '3-4', thread: 't-7', round: '2' });
});

test('every value is URL-encoded and survives the round-trip', () => {
  // Invariant: awkward characters come back from parseRoute exactly and the link is safe in a hash and a markdown destination.
  const file = 'dir/a b&c=d#e%f+g(h)?i é.js';
  const link = threadLink({ id: 'r-1', project: 'my app', worktree: 'a&b' }, thread('open', { file }));
  const r = route(link);
  assert.equal(r.file, file);
  assert.equal(r.project, 'my app');
  assert.equal(r.worktree, 'a&b');
  assert.ok(!/[#\s()]/.test(link.slice(1)), link);
});

test('links are canonical: toSearch(parseRoute(s)) is s', () => {
  // Invariant: every key is one parseRoute accepts, in toSearch's order and encoding. Runs last, over every link built above.
  assert.ok(built.length > 0);
  for (const link of built) {
    const s = link.slice(PREFIX.length);
    assert.equal(toSearch(parseRoute(s)), s);
  }
});
