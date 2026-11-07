// The typed MCP contract: every tool answers in cc's json format ({structured}, valid against its manifest outputSchema)
// or text format ({text}), and refuses with {error, code[, details]} in both.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { world, HUMAN, editLines } from './_world.js';
import { checkSchema, validate } from './_schema.js';
import * as reviews from '../src/reviews.js';
import * as store from '../src/store.js';
import * as threads from '../src/threads.js';
import { handle, refusalBody, _toolNames, _handlers } from '../src/mcp.js';
import { migrateStore } from '../src/migrate.js';
import { views } from '../src/mcpViews.js';
import { MAX_EXCERPT_LINES } from '../src/render.js';
import { HTTP_STATUS } from '../src/refusals.js';
import { MAX_FILE_BYTES } from '../src/git.js';
import { lines } from './_git.js';

const manifest = JSON.parse(fs.readFileSync(new URL('../conductor.plugin.json', import.meta.url), 'utf8'));
const schemaOf = (tool) => manifest.mcp.tools.find((t) => t.name === tool).outputSchema;
const CODE_RE = /^[A-Z][A-Z0-9_]*$/;

let w;
const rev = { sessionId: 's-rev', project: 'app' };
const cond = { sessionId: 's-cond', project: '.conduct' };
const worker = { sessionId: 's-author', project: 'app' };
beforeEach(async () => {
  w = await world();
  w.session('s-author', { worktree: 'feature' });
  w.session('s-rev', { worktree: 'feature' });
  w.session('s-cond', { project: '.conduct' });
});
afterEach(() => w.cleanup());

// Replies go through JSON, as over the wire (undefined fields vanish, as cc sees them).
const raw = async (tool, args, caller = rev, format) => {
  const out = await handle({ tool, arguments: args, caller, ...(format === undefined ? {} : { format }) });
  return { status: out.status, body: JSON.parse(JSON.stringify(out.body)) };
};
/** A tool's json reply: exactly {structured}, valid against its outputSchema. */
const json = async (tool, args, caller = rev) => {
  const { status, body } = await raw(tool, args, caller, 'json');
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(body), ['structured'], JSON.stringify(body).slice(0, 300));
  assert.deepEqual(validate(schemaOf(tool), body.structured), [], `${tool}: ${JSON.stringify(body.structured).slice(0, 300)}`);
  return body.structured;
};
/** A tool's text reply: exactly {text}, prose rather than json. */
const text = async (tool, args, caller = rev) => {
  const { status, body } = await raw(tool, args, caller, 'text');
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(body), ['text'], JSON.stringify(body).slice(0, 300));
  assert.equal(typeof body.text, 'string');
  assert.throws(() => JSON.parse(body.text));
  assert.ok(!body.text.startsWith('{'));
  return body.text;
};
const both = async (tool, args, caller) => [await json(tool, args, caller), await text(tool, args, caller)];

async function reviewOnFeature(extra = {}) {
  const wt = w.addWorktree();
  wt.commit({ 'a.js': editLines({ 2: 'top-edit', 18: 'bottom-edit' }) });
  const out = await json('open_review', { project: 'app', worktree: 'feature', author: 's-author', ...extra }, cond);
  return { wt, review: out.review };
}
const hunkIdsOf = async (id) => (await reviews.diff(id, {})).files[0].hunks.map((h) => h.id);

const walk = (schema, fn) => {
  fn(schema);
  for (const s of Object.values(schema.properties ?? {})) walk(s, fn);
  if (schema.items) walk(schema.items, fn);
  for (const s of schema.anyOf ?? []) walk(s, fn);
  if (schema.additionalProperties && typeof schema.additionalProperties === 'object') walk(schema.additionalProperties, fn);
};

/** The nodes of `schema` whose type admits an object but whose additionalProperties is not exactly false. */
const openObjects = (schema) => {
  const open = [];
  walk(schema, (s) => { if ([s.type].flat().includes('object') && s.additionalProperties !== false) open.push(s); });
  return open;
};

test('every tool declares an outputSchema inside cc\'s subset, an object at the root, with no `ok` property anywhere', () => {
  // Invariant: cc accepts each manifest outputSchema, and no payload can carry `ok`, which cc reads as a refusal marker; the walk reaches anyOf branches and object-valued additionalProperties too.
  assert.ok(manifest.mcp.tools.length > 0);
  for (const tool of manifest.mcp.tools) {
    const schema = tool.outputSchema;
    assert.doesNotThrow(() => checkSchema(schema), tool.name);
    assert.equal(schema.type, 'object', tool.name);
    walk(schema, (s) => {
      assert.ok(!('ok' in (s.properties ?? {})), `${tool.name} declares ok`);
    });
    assert.deepEqual(openObjects(schema), [], `${tool.name}: every object forbids extra properties`);
  }
});

test('shared sub-schemas are one shape: the review in open_review and get_review, the thread in annotate and reply', () => {
  // Invariant: the pasted copies of a shared sub-schema never drift apart.
  assert.deepEqual(schemaOf('open_review').properties.review, schemaOf('get_review').properties.review);
  assert.deepEqual(schemaOf('annotate').properties.thread, schemaOf('reply').properties.thread);
  const listed = schemaOf('list_threads').properties.threads.items;
  const { link, ...rest } = listed.properties;
  assert.ok(link);
  const plain = schemaOf('annotate').properties.thread.properties;
  for (const k of Object.keys(plain)) if (k !== 'messages') assert.deepEqual(rest[k], plain[k], k);
});

test('handlers, views and the manifest name the same tools', () => {
  // Invariant: a tool added to one of the three is added to all of them.
  const names = manifest.mcp.tools.map((t) => t.name).sort();
  assert.deepEqual([..._toolNames()].sort(), names);
  assert.deepEqual(Object.keys(views).sort(), names);
});

test('open_review: json and text for a new, a reused, an uncommitted and a commit review', async () => {
  // Invariant: open_review answers the review (with its link) and whether it was reused; text says which and prints recipient and link.
  const wt = w.addWorktree();
  wt.commit({ 'a.js': editLines({ 2: 'top-edit' }) });
  const args = { project: 'app', worktree: 'feature', author: 's-author' };
  const first = await json('open_review', args, cond);
  assert.equal(first.reused, false);
  assert.match(first.review.link, /^http:\/\/cc\.internal\//);
  const again = await json('open_review', args, cond);
  assert.deepEqual([again.reused, again.review.id], [true, first.review.id]);
  const t = await text('open_review', args, cond);
  assert.match(t, new RegExp(`^reused the open review ${first.review.id}\n`));
  assert.match(t, /recipient: s-cond \(conductor\)/);
  assert.match(t, /link: http:\/\/cc\.internal\//);
  wt.write('a.js', editLines({ 2: 'X' }));
  const un = await json('open_review', { project: 'app', worktree: 'feature', kind: 'uncommitted' }, cond);
  assert.deepEqual([un.review.kind, un.review.counts.hunks, un.review.groups], ['uncommitted', { total: 1 }, null]);
  assert.match(await text('open_review', { project: 'app', worktree: 'feature', kind: 'uncommitted' }, cond), /^reused the open review/);
  const commit = await json('open_review', { project: 'app', worktree: 'feature', kind: 'commit' }, cond);
  assert.equal(commit.review.kind, 'commit');
  assert.match(await text('open_review', { project: 'app', worktree: 'feature', kind: 'commit', title: 'other' }, cond), /^reused the open review/);
});

test('get_review: json and text with groups and a retired group, uncommitted, and with the checkout gone', async () => {
  // Invariant: get_review json is the whole rollup (valid against its schema); text prints mergeBlockers and the link; an unreadable diff is review.snapshotError, not a refusal.
  const { wt, review } = await reviewOnFeature();
  const [h1, h2] = await hunkIdsOf(review.id);
  await json('propose_groups', { review: review.id, groups: [{ title: 'one', description: 'd', hunks: [h1] }] });
  await json('propose_groups', { review: review.id, groups: [{ title: 'both', description: 'd', hunks: [h1, h2] }] });
  await json('annotate', { review: review.id, anchor: 'review', kind: 'comment', body: 'overall' });
  const [got, t] = await both('get_review', { review: review.id });
  assert.deepEqual(got.guide.retired.map((g) => g.title), ['one']);
  assert.deepEqual(got.reviewThreads, { open: 1, resolved: 0, outdated: 0 });
  assert.match(t, /mergeBlockers: \d+/);
  assert.match(t, /^link: http:\/\/cc\.internal\//m);

  wt.write('a.js', editLines({ 2: 'X' }));
  const un = await json('open_review', { project: 'app', worktree: 'feature', kind: 'uncommitted' }, cond);
  const [ug] = await both('get_review', { review: un.review.id });
  assert.deepEqual([ug.guide, ug.files[0].verdicts], [null, null]);

  wt.destroy();
  const [gone] = await both('get_review', { review: un.review.id });
  assert.deepEqual([gone.review.snapshotError, gone.review.checkoutGone, gone.files], ['CHECKOUT_GONE', true, []]);
  assert.equal((await json('get_review', { review: review.id })).review.checkoutGone, true);
});

test('list_threads: json and text for line, file, review and group threads, a resolved citation and an unresolvable one', async () => {
  // Invariant: json threads carry anchors, anchorLines, messages with excerpts and a link each; text prints a [id] header and a link: line per thread in listed order.
  const { review } = await reviewOnFeature();
  const [h1] = await hunkIdsOf(review.id);
  await json('propose_groups', { review: review.id, groups: [{ title: 'g', description: 'd', hunks: [h1] }] });
  await json('annotate', { review: review.id, anchor: 'lines', kind: 'question', body: 'see a.js#L18 and nope.js#L1', file: 'a.js', startLine: 2 });
  await json('annotate', { review: review.id, anchor: 'file', kind: 'comment', body: 'f', file: 'a.js' });
  await json('annotate', { review: review.id, anchor: 'review', kind: 'comment', body: 'r' });
  await json('annotate', { review: review.id, anchor: 'group', group: 'g1', kind: 'comment', body: 'g' });
  const [got, t] = await both('list_threads', { review: review.id });
  assert.deepEqual(got.threads.map((x) => x.anchor.kind), ['lines', 'file', 'review', 'group']);
  assert.deepEqual(got.counts, { open: 4, resolved: 0, outdated: 0 });
  const [cited, bad] = got.threads[0].messages[0].excerpts;
  assert.deepEqual([cited.path, cited.lines[0].text, typeof bad.error], ['a.js', 'bottom-edit', 'string']);
  assert.match(t, /^\[t1\] question/m);
  assert.deepEqual([...t.matchAll(/^link: (.+)$/gm)].map((m) => m[1]), got.threads.map((x) => x.link));
  assert.equal(await text('list_threads', { review: review.id, status: 'resolved' }), 'no resolved threads');
  assert.deepEqual((await json('list_threads', { review: review.id, status: 'resolved' })).threads, []);
});

test('get_hunk: json and text for a text hunk, and the file-level hunk of a too-large untracked file', async () => {
  // Invariant: get_hunk json carries the numbered lines and the snapshot flags (tooLarge); text says why a file-level hunk has no lines.
  const { review } = await reviewOnFeature();
  const [h1] = await hunkIdsOf(review.id);
  const [got, t] = await both('get_hunk', { review: review.id, hunk: h1 });
  assert.equal(got.hunks[0].kind, 'text');
  assert.ok(got.hunks[0].lines.length > 0);
  assert.deepEqual([got.binary, got.tooLarge, got.hunks[0].verdict], [false, false, 'pending']);
  assert.match(t, /top-edit/);

  w.addWorktree('big').write('big.txt', 'x'.repeat(MAX_FILE_BYTES + 1) + '\n');
  const un = await json('open_review', { project: 'app', worktree: 'big', kind: 'uncommitted' }, cond);
  const [big, bt] = await both('get_hunk', { review: un.review.id, file: 'big.txt' });
  assert.deepEqual([big.tooLarge, big.binary, big.hunks[0].kind, big.hunks[0].verdict], [true, false, 'file', null]);
  assert.match(bt, /\(too large to diff: no lines\)/);
  const files = (await json('get_review', { review: un.review.id })).files;
  assert.equal(files.find((f) => f.path === 'big.txt').tooLarge, true);
});

test('annotate: json and text on every anchor kind', async () => {
  // Invariant: annotate answers {thread} (no fileSig); text says `started thread tN` and where.
  const { review } = await reviewOnFeature();
  const [h1] = await hunkIdsOf(review.id);
  await json('propose_groups', { review: review.id, groups: [{ title: 'g', description: 'd', hunks: [h1] }] });
  const cases = [
    [{ anchor: 'lines', file: 'a.js', startLine: 2, endLine: 3 }, 'lines', 'a.js#L2-L3'],
    [{ anchor: 'hunk', hunk: h1 }, 'lines', 'a.js#L'],
    [{ anchor: 'file', file: 'a.js' }, 'file', 'a.js (whole file)'],
    [{ anchor: 'group', group: 'g1' }, 'group', 'group g1'],
    [{ anchor: 'review' }, 'review', 'the review'],
  ];
  for (const [args, kind, where] of cases) {
    const full = { review: review.id, kind: 'finding', severity: 'minor', body: 'x', ...args };
    assert.equal((await json('annotate', full)).thread.anchor.kind, kind);
    assert.match(await text('annotate', full), new RegExp(`^started thread t\\d+ · finding/minor · open · on ${where.replace(/[().]/g, '\\$&')}`));
  }
});

test('reply: json and text for a closed finding and a proposed resolution', async () => {
  // Invariant: reply answers the thread as it now stands; text says resolved (disposition) or resolution proposed.
  const { review } = await reviewOnFeature();
  const mk = async (kind, extra = {}) => (await json('annotate', { review: review.id, anchor: 'lines', kind, body: 'x', file: 'a.js', startLine: 2, ...extra })).thread.id;
  const finding = await mk('finding', { severity: 'nit' });
  const closed = await json('reply', { review: review.id, thread: finding, body: 'ok', resolve: true, disposition: 'fixed' }, rev);
  assert.deepEqual([closed.thread.status, closed.thread.disposition], ['resolved', 'fixed']);
  const f2 = await mk('finding', { severity: 'nit' });
  assert.match(await text('reply', { review: review.id, thread: f2, body: 'ok', resolve: true, disposition: 'fixed' }, rev), new RegExp(`^replied on thread ${f2} \\(m\\d+\\) · resolved \\(fixed\\)$`));
  const human = (await threads.annotate(review.id, HUMAN, { anchor: { kind: 'lines', file: 'a.js', side: 'new', startLine: 18, endLine: 18 }, kind: 'comment', body: 'h' })).thread.id;
  const proposed = await json('reply', { review: review.id, thread: human, body: 'ok', resolve: true }, rev);
  assert.equal(proposed.thread.resolveProposed, true);
  const plain = await mk('comment');
  assert.match(await text('reply', { review: review.id, thread: plain, body: 'more' }, rev), /· open$/);
  assert.match(await text('reply', { review: review.id, thread: human, body: 'again', resolve: true }, rev), /· resolution proposed to the human$/);
});

test('propose_groups: json and text', async () => {
  // Invariant: the proposal answer names the stored groups, the counts and the hunks left ungrouped.
  const { review } = await reviewOnFeature();
  const [h1, h2] = await hunkIdsOf(review.id);
  const groups = [{ title: 'Top', description: 'd', hunks: [h1] }];
  const res = await json('propose_groups', { review: review.id, groups });
  assert.deepEqual([res.kept, res.retired, res.ungrouped], [0, 0, [h2]]);
  const t = await text('propose_groups', { review: review.id, groups }); // the same hunks again: the group is kept
  assert.match(t, /^proposed 1 groups \(kept 1, retired 0; 0 group threads outdated\)\n1\. \[g1\] pending · Top · h:/);
  assert.match(t, new RegExp(`ungrouped: h:${h2}$`));
  assert.match(await text('propose_groups', { review: review.id, groups: [{ title: 'All', description: 'd', hunks: [h1, h2] }] }), /\nungrouped: none$/);
});

test('refresh_review: json and text, unchanged and changed', async () => {
  // Invariant: refresh answers the round and its counts; text says unchanged, or `round N:` with the counts.
  const { wt, review } = await reviewOnFeature();
  const [same, t] = await both('refresh_review', { review: review.id });
  assert.deepEqual([same.unchanged, 'hunks' in same], [true, false]);
  assert.match(t, /^round 1 unchanged: nothing new to snapshot$/);
  wt.commit({ 'b.js': 'z\n' });
  const changed = await json('refresh_review', { review: review.id });
  assert.deepEqual([changed.unchanged, changed.round], [false, 2]);
  wt.commit({ 'b.js': 'zz\n' });
  assert.match(await text('refresh_review', { review: review.id }), /^round 3: hunks \d+ kept, \d+ reset to pending, \d+ new · threads \d+ moved, \d+ drifted, \d+ outdated, \d+ dropped · groups \d+ kept, \d+ dropped$/);
});

test('an absent or null format answers text; an unknown format is 400 and runs nothing', async () => {
  // Invariant: only json and text are formats; a missing one is text (a pre-format host); a bad one is a malformed envelope.
  const { review } = await reviewOnFeature();
  const args = { review: review.id, anchor: 'review', kind: 'comment', body: 'x' };
  assert.deepEqual(Object.keys((await raw('annotate', args, rev)).body), ['text']);
  const viaNull = await handle({ tool: 'annotate', arguments: args, caller: rev, format: null });
  assert.deepEqual(Object.keys(viaNull.body), ['text']);
  assert.equal(store.read(review.id).threads.length, 2);
  for (const format of ['xml', '', 'JSON', 1]) {
    const bad = await handle({ tool: 'annotate', arguments: args, caller: rev, format });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /format must be "json" or "text"/);
  }
  assert.equal(store.read(review.id).threads.length, 2);
});

test('a refusal is {error, code} in both formats with the same code; unknown tools and unexpected failures are told apart', async () => {
  // Invariant: a service refusal keeps its code in json and text; an unknown tool is TOOL_UNKNOWN; an unexpected exception is {error} with no code.
  const { review } = await reviewOnFeature();
  const cases = [
    ['get_review', { review: 'r-0000000000' }, rev, 'REVIEW_UNKNOWN'],
    ['annotate', { review: review.id, anchor: 'review', kind: 'comment', body: 'x' }, {}, 'CALLER_UNKNOWN'],
    ['get_hunk', { review: review.id }, rev, 'INVALID_ARGUMENT'],
    ['get_hunk', { review: review.id, hunk: 'nope' }, rev, 'HUNK_UNKNOWN'],
    ['propose_groups', { review: review.id, groups: [{ title: 't', description: 'd', hunks: [] }] }, rev, 'GROUP_EMPTY'],
    ['reply', { review: review.id, thread: 't99', body: 'x' }, rev, 'THREAD_UNKNOWN'],
    ['list_threads', { review: review.id, status: 'bogus' }, rev, 'INVALID_ARGUMENT'],
    ['open_review', { project: 'app' }, {}, 'CALLER_UNKNOWN'],
    ['refresh_review', { review: (await json('open_review', { project: 'app', worktree: 'feature', kind: 'commit' }, cond)).review.id }, rev, 'IMMUTABLE_TARGET'],
  ];
  for (const [tool, args, caller, code] of cases) {
    for (const format of ['json', 'text']) {
      const { status, body } = await raw(tool, args, caller, format);
      assert.equal(status, 200);
      assert.deepEqual(Object.keys(body).sort(), ['code', 'error'], `${tool} ${format}: ${JSON.stringify(body)}`);
      assert.equal(body.code, code, `${tool} ${format}`);
      assert.match(body.code, CODE_RE);
      assert.equal(typeof body.error, 'string');
    }
  }
  for (const format of ['json', 'text']) {
    const unknown = await raw('nope', {}, rev, format);
    assert.deepEqual(unknown.body, { error: 'unknown tool: nope', code: 'TOOL_UNKNOWN' });
  }
  // An exception that is not a Refusal has no code.
  const boom = { get sessionId() { throw new Error('boom'); } };
  for (const format of ['json', 'text']) assert.deepEqual((await raw('annotate', { review: review.id }, boom, format)).body, { error: 'boom' });
});

test('every refusal code the plugin defines is a valid cc code name', () => {
  // Invariant: cc accepts a refusal code only as ^[A-Z][A-Z0-9_]*$.
  for (const code of Object.keys(HTTP_STATUS)) assert.match(code, CODE_RE);
});

test('a refusal\'s extra fields travel as `details`, a plain object, and only when there are some', () => {
  // Invariant: refusalBody puts fields beyond ok/code/reason into `details` and never into `error`; no extras, no `details`. (No service refusal carries extras today.)
  assert.deepEqual(refusalBody({ ok: false, code: 'X_CODE', reason: 'why' }), { error: 'why', code: 'X_CODE' });
  const body = refusalBody({ ok: false, code: 'X_CODE', reason: 'why', ids: ['a', 'b'], hint: { n: 2 } });
  assert.deepEqual(body, { error: 'why', code: 'X_CODE', details: { ids: ['a', 'b'], hint: { n: 2 } } });
  assert.equal(body.error.includes('ids'), false);
});

test('json excerpts are whole while text cuts at the cap and says how to read the rest', async () => {
  // Invariant: the json view never truncates a cited excerpt (and has no `truncated`); the text view shows MAX_EXCERPT_LINES lines then a marker naming the hidden range.
  const n = MAX_EXCERPT_LINES + 20;
  const wt = w.addWorktree();
  wt.commit({ 'a.js': lines(n) });
  const { review } = await json('open_review', { project: 'app', worktree: 'feature', author: 's-author' }, cond);
  await json('annotate', { review: review.id, anchor: 'review', kind: 'comment', body: `read a.js#L1-L${n}` });
  const got = await json('list_threads', { review: review.id });
  const [e] = got.threads[0].messages[0].excerpts;
  assert.equal(e.lines.length, n);
  assert.equal('truncated' in e, false);
  const t = await text('list_threads', { review: review.id });
  assert.equal(t.split('\n').filter((l) => /^\s+\d+  l\d+$/.test(l)).length, MAX_EXCERPT_LINES);
  assert.match(t, new RegExp(`… 20 more lines \\(L${MAX_EXCERPT_LINES + 1}-L${n}\\) not shown: read a\\.js lines ${MAX_EXCERPT_LINES + 1}-${n} at [0-9a-f]{7}`));
});

test('get_review json carries the guide and files whole', async () => {
  // Invariant: nothing the service's guide holds is trimmed in json except the group thread bodies (list_threads has them); files lose only the UI's sig.
  const { review } = await reviewOnFeature();
  const [h1, h2] = await hunkIdsOf(review.id);
  const long = `## Why\n\n${'a long markdown description. '.repeat(40)}`;
  await json('propose_groups', { review: review.id, groups: [{ title: 'one', description: long, hunks: [h1] }] }, cond);
  await json('propose_groups', { review: review.id, groups: [{ title: 'two', description: long, hunks: [h1, h2] }] }, cond);
  const got = await json('get_review', { review: review.id });
  const svc = await reviews.getReview(review.id);
  const { threads, ...guide } = JSON.parse(JSON.stringify(svc.guide));
  assert.ok(threads);
  assert.deepEqual(got.guide, guide);
  assert.equal(got.guide.groups[0].description, long);
  assert.equal(got.guide.groups[0].proposedBy.role, 'conductor');
  assert.equal(got.guide.retired.length, 1);
  assert.ok(got.guide.groups[0].hunks.every((h) => typeof h.file === 'string'));
  assert.deepEqual(got.files, JSON.parse(JSON.stringify(svc.files.map(({ sig, ...f }) => f))));
  assert.ok(svc.files.every((f) => f.sig));
});

test('the schema walk reaches anyOf branches and object-valued additionalProperties', () => {
  // Invariant: `walk` visits every sub-schema, so the `ok` and additionalProperties checks cannot skip a nested one.
  const seen = [];
  walk({ type: 'object', additionalProperties: { type: 'string' }, properties: { a: { anyOf: [{ type: 'integer' }, { type: 'object', additionalProperties: false }] } } }, (x) => seen.push(x.type));
  assert.deepEqual(seen.map(String).sort(), ['integer', 'object', 'object', 'string', 'undefined']);
  // Invariant: an object node is open unless additionalProperties is false, whether or not it lists properties.
  assert.equal(openObjects({ type: 'object', additionalProperties: false, properties: { a: { type: 'object', additionalProperties: true } } }).length, 1);
  assert.equal(openObjects({ type: ['object', 'null'], additionalProperties: { type: 'string' } }).length, 1);
  assert.equal(openObjects({ type: 'object' }).length, 1);
  assert.equal(openObjects({ type: 'object', additionalProperties: false, properties: { a: { anyOf: [{ type: 'object', additionalProperties: false }] } } }).length, 0);
});

test('a prototype key is not a tool: toString, constructor and hasOwnProperty are TOOL_UNKNOWN', async () => {
  // Invariant: handle looks tools up as own keys only, so Object.prototype members answer {error, code: TOOL_UNKNOWN}.
  for (const tool of ['toString', 'constructor', 'hasOwnProperty', '__proto__']) {
    for (const format of ['json', 'text']) {
      const out = await raw(tool, {}, rev, format);
      assert.deepEqual(out.body, { error: `unknown tool: ${tool}`, code: 'TOOL_UNKNOWN' }, tool);
    }
  }
});

test('a review stored without `author`, once migrated, answers get_review and a reused open_review within their schemas', async () => {
  // Invariant: the boot migration (migrateStore, which start() awaits before serving; MCP reads go through store.read) gives a pre-author review author null, so its json replies validate; the read path itself defaults nothing.
  const { review } = await reviewOnFeature();
  const file = `${w.store.dir}/reviews/${review.id}.json`;
  const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete stored.author;
  fs.writeFileSync(file, JSON.stringify(stored));
  await migrateStore();
  assert.equal(store.read(review.id).author, null);
  assert.equal((await json('get_review', { review: review.id })).review.author, null);
  const again = await json('open_review', { project: 'app', worktree: 'feature', author: 's-author' }, cond);
  assert.deepEqual([again.reused, again.review.author], [true, null]);
});

test('get_hunk on a binary file: json says binary and text says there are no lines', async () => {
  // Invariant: the snapshot's binary flag reaches get_hunk json (`binary: true`) and the text head of its file-level hunk reads `(binary file: no lines)`.
  const wt = w.addWorktree();
  wt.commit({ 'logo.png': Buffer.from([0, 27, 91, 0, 255, 10]) });
  const { review } = await json('open_review', { project: 'app', worktree: 'feature', author: 's-author' }, cond);
  const [got, t] = await both('get_hunk', { review: review.id, file: 'logo.png' });
  assert.deepEqual([got.binary, got.tooLarge, got.hunks[0].kind], [true, false, 'file']);
  assert.match(t, /\(binary file: no lines\)/);
});

test('open_review text opens a new review as `opened`, then says `reused`', async () => {
  // Invariant: the first call on a checkout answers `opened review <id>`; the next, the same id as `reused the open review`.
  w.addWorktree().commit({ 'a.js': editLines({ 2: 'x' }) });
  const args = { project: 'app', worktree: 'feature', author: 's-author' };
  const first = await text('open_review', args, cond);
  const id = first.match(/^opened review (r-[0-9a-f]+)\n/)?.[1];
  assert.ok(id, first);
  assert.match(await text('open_review', args, cond), new RegExp(`^reused the open review ${id}\n`));
});

test('list_threads counts tally the whole review while threads holds only those of the status asked', async () => {
  // Invariant: `counts` is the whole review's tally (here 1 resolved, 1 open) though the default status lists only the open thread.
  const { review } = await reviewOnFeature();
  const mk = async (line) => (await json('annotate', { review: review.id, anchor: 'lines', kind: 'comment', body: 'x', file: 'a.js', startLine: line })).thread.id;
  const [a] = [await mk(2), await mk(18)];
  assert.equal((await threads.setThreadStatus(review.id, a, { status: 'resolved' })).ok, true);
  const got = await json('list_threads', { review: review.id });
  assert.deepEqual(got.counts, { open: 1, resolved: 1, outdated: 0 });
  assert.equal(got.threads.length, 1);
  assert.equal(got.threads[0].status, 'open');
});

test('refresh_review reports exact counts in json and the same numbers in text', async () => {
  // Invariant: a refresh keeps the verdict of an unchanged hunk, counts a new hunk, and text prints the json's numbers.
  const { wt, review } = await reviewOnFeature();
  const [h1] = await hunkIdsOf(review.id);
  await reviews.setVerdict(review.id, h1, 'accepted');
  wt.commit({ 'b.js': 'z\n' });
  const got = await json('refresh_review', { review: review.id });
  assert.deepEqual(got, { unchanged: false, round: 2, hunks: { kept: 1, reset: 0, new: 1 }, threads: { moved: 0, drifted: 0, outdated: 0, dropped: 0 }, groups: { kept: 0, dropped: 0 } });
  wt.commit({ 'b.js': 'zz\n' });
  assert.equal(await text('refresh_review', { review: review.id }), 'round 3: hunks 1 kept, 0 reset to pending, 1 new · threads 0 moved, 0 drifted, 0 outdated, 0 dropped · groups 0 kept, 0 dropped');
});

test('a stubbed refusal with extra fields reaches the wire as details, in both formats', async () => {
  // Invariant: handle passes fields a refusal carries beyond code and reason as `details`, never into `error`.
  const real = _handlers.get_review;
  _handlers.get_review = async () => ({ ok: false, code: 'X_STUB', reason: 'stubbed', extra: { ids: ['a'] } });
  try {
    for (const format of ['json', 'text']) {
      assert.deepEqual((await raw('get_review', { review: 'r-x' }, rev, format)).body, { error: 'stubbed', code: 'X_STUB', details: { extra: { ids: ['a'] } } });
    }
  } finally { _handlers.get_review = real; }
});

test('annotate with no severity omits it from the ack; a reply that resolves a comment says plain `resolved`', async () => {
  // Invariant: the started header carries `/severity` only for a finding; a comment closes with no disposition and the ack says just `resolved`.
  const { review } = await reviewOnFeature();
  const args = { review: review.id, anchor: 'lines', kind: 'comment', body: 'x', file: 'a.js', startLine: 2 };
  assert.match(await text('annotate', args), /^started thread t\d+ · comment · open · on a\.js#L2$/);
  const id = (await json('annotate', args)).thread.id;
  assert.match(await text('reply', { review: review.id, thread: id, body: 'done', resolve: true }), new RegExp(`^replied on thread ${id} \\(m\\d+\\) · resolved$`));
});
