import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupsHolding, groupVerdictWrites, contradictedGroups, checkProposal, MAX_GROUP_TITLE_CHARS } from '../src/grouping.js';
import { MAX_BODY_CHARS } from '../src/threads.js';

// Hand-built review objects: only the fields the pure rules read.
const v = (verdict) => ({ verdict, seq: 1, at: 'x' });
const group = (id, hunkIds, verdict = null) => ({ id, order: 1, title: id, description: 'd', hunkIds, verdict: verdict && v(verdict) });
const mk = (groups, verdicts = {}) => ({
  groups,
  verdicts: Object.fromEntries(Object.entries(verdicts).map(([h, x]) => [h, v(x)])),
});
const verdictsOf = (r) => Object.fromEntries(Object.entries(r.verdicts).map(([h, x]) => [h, x.verdict]));
const groupVerdicts = (r) => Object.fromEntries(r.groups.map((g) => [g.id, g.verdict?.verdict ?? 'pending']));

// The services' write path in miniature: the group's own verdict plus the planned hunk writes, nothing else.
function apply(r, id, verdict) {
  const g = r.groups.find((x) => x.id === id);
  const writes = groupVerdictWrites(r, g, verdict);
  g.verdict = verdict === 'pending' ? null : v(verdict);
  for (const w of writes) {
    if (w.verdict === 'pending') delete r.verdicts[w.hunkId];
    else r.verdicts[w.hunkId] = v(w.verdict);
  }
  return writes;
}

test('groupsHolding lists the current groups that contain the hunk', () => {
  // Invariant: multi-membership is read from the groups' hunkIds alone.
  const r = mk([group('g1', ['a', 'h']), group('g2', ['h', 'b']), group('g3', ['b'])]);
  assert.deepEqual(groupsHolding(r, 'h').map((g) => g.id), ['g1', 'g2']);
  assert.deepEqual(groupsHolding(r, 'zzz'), []);
});

test('accepting a group accepts a shared hunk only once every group holding it is accepted', () => {
  // Invariant: Accept rule: a hunk is accepted by a group only when all its groups are accepted.
  const r = mk([group('g1', ['a', 'h']), group('g2', ['h', 'b'])]);
  apply(r, 'g1', 'accepted');
  assert.deepEqual(verdictsOf(r), { a: 'accepted' });
  apply(r, 'g2', 'accepted');
  assert.deepEqual(verdictsOf(r), { a: 'accepted', h: 'accepted', b: 'accepted' });
});

test('accepting a group leaves a hunk rejected while a rejected group holds it', () => {
  // Invariant I3: every hunk of a rejected group is rejected.
  const r = mk([group('g1', ['a', 'h']), group('g2', ['h', 'b'], 'rejected')], { h: 'rejected', b: 'rejected' });
  apply(r, 'g1', 'accepted');
  assert.deepEqual(verdictsOf(r), { a: 'accepted', h: 'rejected', b: 'rejected' });
});

test('accepting a group overrides a pending or rejected hunk that only accepted groups hold', () => {
  // Invariant: Accept rule: "whatever its verdict was" for hunks all of whose groups are accepted.
  const r = mk([group('g1', ['a', 'b'])], { a: 'rejected' });
  const writes = apply(r, 'g1', 'accepted');
  assert.deepEqual(writes.map((w) => w.hunkId).sort(), ['a', 'b']);
  assert.deepEqual(verdictsOf(r), { a: 'accepted', b: 'accepted' });
});

test('rejecting a group rejects every hunk of it and touches no other group', () => {
  // Invariant: Reject rule; group actions never change another group's verdict.
  const r = mk([group('g1', ['a', 'h'], 'accepted'), group('g2', ['h', 'b'])], { a: 'accepted', h: 'accepted' });
  const writes = apply(r, 'g2', 'rejected');
  assert.deepEqual(writes, [{ hunkId: 'h', verdict: 'rejected' }, { hunkId: 'b', verdict: 'rejected' }]);
  assert.deepEqual(groupVerdicts(r), { g1: 'accepted', g2: 'rejected' });
  assert.deepEqual(verdictsOf(r), { a: 'accepted', h: 'rejected', b: 'rejected' });
});

test('writes list only hunks whose verdict changes', () => {
  // Invariant: groupVerdictWrites is minimal, so a repeated action writes nothing.
  const r = mk([group('g1', ['a', 'b'], 'rejected')], { a: 'rejected', b: 'rejected' });
  assert.deepEqual(groupVerdictWrites(r, r.groups[0], 'rejected'), []);
});

test('reopening a group sets its hunks pending except one a rejected group holds', () => {
  // Invariant D5: Pending group; the exemption keeps I3.
  const r = mk([group('g1', ['a', 'h'], 'accepted'), group('g2', ['h', 'b'], 'rejected')], { a: 'accepted', h: 'rejected', b: 'rejected' });
  apply(r, 'g1', 'pending');
  assert.deepEqual(groupVerdicts(r), { g1: 'pending', g2: 'rejected' });
  assert.deepEqual(verdictsOf(r), { h: 'rejected', b: 'rejected' });
});

test('pending on a pending group writes nothing', () => {
  // Invariant D5: reopening a pending group is a no-op.
  const r = mk([group('g1', ['a'])]);
  assert.deepEqual(groupVerdictWrites(r, r.groups[0], 'pending'), []);
});

test('accept G1 then reject G2 gives the same state as reject G2 then accept G1', () => {
  // Invariant: order independence of group actions.
  const build = () => mk([group('g1', ['a', 'h']), group('g2', ['h', 'b']), group('g3', ['b', 'c'])]);
  const x = build();
  apply(x, 'g1', 'accepted'); apply(x, 'g2', 'rejected'); apply(x, 'g3', 'accepted');
  const y = build();
  apply(y, 'g3', 'accepted'); apply(y, 'g2', 'rejected'); apply(y, 'g1', 'accepted');
  assert.deepEqual(groupVerdicts(x), groupVerdicts(y));
  assert.deepEqual(verdictsOf(x), verdictsOf(y));
  assert.equal(verdictsOf(x).h, 'rejected');
});

test('contradictedGroups returns exactly the containing groups with a verdict that differs', () => {
  // Invariant D1: a direct hunk verdict clears the groups it contradicts and no others.
  const r = mk([
    group('g1', ['h'], 'accepted'), group('g2', ['h'], 'rejected'), group('g3', ['h']), group('g4', ['x'], 'accepted'),
  ]);
  const ids = (verdict) => contradictedGroups(r, 'h', verdict).map((g) => g.id);
  assert.deepEqual(ids('accepted'), ['g2']);
  assert.deepEqual(ids('rejected'), ['g1']);
  assert.deepEqual(ids('pending'), ['g1', 'g2']);
});

const specs = (...s) => s;
const ok = { title: 't', description: 'd', hunks: ['a'] };
const known = new Set(['a', 'b']);
const proposal = [
  ['no list', 'x', 'INVALID_ARGUMENT'],
  ['empty list', [], 'INVALID_ARGUMENT'],
  ['item not an object', [null], 'INVALID_ARGUMENT'],
  ['item an array', [[]], 'INVALID_ARGUMENT'],
  ['unknown key', [{ ...ok, order: 1 }], 'INVALID_ARGUMENT'],
  ['missing title', [{ description: 'd', hunks: ['a'] }], 'INVALID_ARGUMENT'],
  ['blank title', [{ ...ok, title: '  ' }], 'INVALID_ARGUMENT'],
  ['long title', [{ ...ok, title: 'x'.repeat(MAX_GROUP_TITLE_CHARS + 1) }], 'INVALID_ARGUMENT'],
  ['missing description', [{ title: 't', hunks: ['a'] }], 'INVALID_ARGUMENT'],
  ['blank description', [{ ...ok, description: '' }], 'INVALID_ARGUMENT'],
  ['long description', [{ ...ok, description: 'x'.repeat(MAX_BODY_CHARS + 1) }], 'BODY_TOO_LARGE'],
  ['hunks missing', [{ title: 't', description: 'd' }], 'INVALID_ARGUMENT'],
  ['hunks not strings', [{ ...ok, hunks: [1] }], 'INVALID_ARGUMENT'],
  ['hunks a string', [{ ...ok, hunks: 'a' }], 'INVALID_ARGUMENT'],
  ['empty hunks', [{ ...ok, hunks: [] }], 'GROUP_EMPTY'],
  ['repeated hunk in a group', [{ ...ok, hunks: ['a', 'a'] }], 'INVALID_ARGUMENT'],
  ['hunk not in the round', [{ ...ok, hunks: ['a', 'zzz'] }], 'HUNK_UNKNOWN'],
  ['same hunk set twice', [ok, { ...ok, title: 'u', hunks: ['a'] }], 'INVALID_ARGUMENT'],
];
for (const [name, input, code] of proposal) {
  test(`checkProposal refuses ${name} with ${code}`, () => {
    // Invariant: proposal validation throws before anything is written.
    assert.throws(() => checkProposal(input, known), (e) => e.code === code);
  });
}

test('checkProposal accepts a hunk in several groups and names the offending group', () => {
  // Invariant: multi-membership is allowed; refusals name the group's position and the id.
  assert.doesNotThrow(() => checkProposal(specs(ok, { ...ok, title: 'u', hunks: ['a', 'b'] }), known));
  assert.throws(() => checkProposal(specs(ok, { ...ok, hunks: ['zzz'] }), known), /group 2.*zzz/);
  assert.throws(() => checkProposal(specs(ok, { ...ok, title: 'u' }), known), /groups 1 and 2 have the same hunks/);
});
