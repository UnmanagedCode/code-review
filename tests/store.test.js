import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tempStore } from './_store.js';
import { storeRoot } from '../src/paths.js';
import { Refusal, attempt } from '../src/refusals.js';
import * as store from '../src/store.js';

let ts;
afterEach(() => { ts?.cleanup(); ts = null; });
const fresh = () => { ts = tempStore(); return ts; };

test('a review round-trips through the store unchanged apart from rev', async () => {
  fresh();
  const id = store.newId();
  const r = { id, rev: 0, title: 'x', nested: { a: [1, 2] } };
  store.write(r);
  const back = store.read(id);
  assert.deepEqual(back, { ...r, rev: 1 });
  assert.deepEqual(store.list().map((x) => x.id), [id]);
});

test('an atomic write leaves no temp file behind', () => {
  const { dir } = fresh();
  const id = store.newId();
  store.write({ id, rev: 0 });
  store.write(store.read(id));
  assert.deepEqual(fs.readdirSync(path.join(dir, 'reviews')), [`${id}.json`]);
});

test('every write bumps rev and emits a change; remove emits deleted', () => {
  fresh();
  const events = [];
  const on = (e) => events.push(e);
  store.changes.on('change', on);
  try {
    const id = store.newId();
    store.write({ id, rev: 0 });
    store.write(store.read(id));
    store.remove(id);
    assert.deepEqual(events, [{ id, rev: 1 }, { id, rev: 2 }, { id, deleted: true }]);
    assert.equal(store.read(id), null);
  } finally {
    store.changes.off('change', on);
  }
});

test('20 concurrent locked appends lose nothing', async () => {
  fresh();
  const id = store.newId();
  store.write({ id, rev: 0, items: [] });
  await Promise.all(Array.from({ length: 20 }, (_, i) => store.mutate(id, async (r) => {
    const snapshot = r.items.length;
    await new Promise((res) => setImmediate(res));
    r.items = [...r.items.slice(0, snapshot), i];
  })));
  const items = store.read(id).items;
  assert.equal(items.length, 20);
  assert.equal(new Set(items).size, 20);
});

test('mutate returns a refusal without writing, and REVIEW_UNKNOWN for a missing review', async () => {
  fresh();
  const id = store.newId();
  store.write({ id, rev: 0, n: 0 });
  const res = await store.mutate(id, (r) => { r.n = 9; return { ok: false, code: 'NOPE', reason: 'x' }; });
  assert.equal(res.code, 'NOPE');
  assert.equal(store.read(id).n, 0);
  assert.equal((await store.mutate('r-0000000000', () => ({}))).code, 'REVIEW_UNKNOWN');
});

test('a mutation that changes nothing writes nothing and does not bump rev', async () => {
  fresh();
  const id = store.newId();
  store.write({ id, rev: 0, n: 0 });
  await store.mutate(id, () => ({}));
  assert.equal(store.read(id).rev, 1);
  await store.mutate(id, (r) => { r.n = 1; });
  assert.equal(store.read(id).rev, 2);
});

test('ids that are not store-shaped never touch the filesystem', async () => {
  fresh();
  assert.equal(store.read('../../etc/passwd'), null);
  assert.equal((await store.mutate('../x', () => ({}))).code, 'REVIEW_UNKNOWN');
});

/** Runs fn with CONDUCTOR_PLUGIN_DATA_DIR (and the legacy vars) set to the given values; restores all after. */
function withEnv(vars, fn) {
  const names = ['CONDUCTOR_PLUGIN_DATA_DIR', 'CODE_REVIEW_STORE', 'PROJECTS_ROOT'];
  const saved = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  for (const n of names) delete process.env[n];
  Object.assign(process.env, vars);
  const restore = () => { for (const n of names) { if (saved[n] === undefined) delete process.env[n]; else process.env[n] = saved[n]; } };
  return Promise.resolve().then(fn).finally(restore);
}

test('storeRoot returns an absolute CONDUCTOR_PLUGIN_DATA_DIR unchanged', () => withEnv({ CONDUCTOR_PLUGIN_DATA_DIR: '/some/data/code-review' }, () => {
  // Invariant: the data dir cc assigns is the store root, verbatim.
  assert.equal(storeRoot(), '/some/data/code-review');
}));

for (const [label, value] of [['unset', undefined], ['empty', ''], ['relative', 'data/code-review']]) {
  test(`a ${label} data dir refuses STORE_UNCONFIGURED`, () => withEnv(value === undefined ? {} : { CONDUCTOR_PLUGIN_DATA_DIR: value }, async () => {
    // Invariant: only an absolute data dir configures the store; the store API surfaces the same refusal.
    assert.throws(() => storeRoot(), (e) => e instanceof Refusal && e.code === 'STORE_UNCONFIGURED');
    assert.equal((await attempt(() => store.list())).code, 'STORE_UNCONFIGURED');
  }));
}

test('PROJECTS_ROOT and CODE_REVIEW_STORE alone never configure the store', () => withEnv({ PROJECTS_ROOT: '/some/projects', CODE_REVIEW_STORE: '/explicit/store' }, () => {
  // Invariant: no legacy fallback in core code.
  assert.throws(() => storeRoot(), (e) => e instanceof Refusal && e.code === 'STORE_UNCONFIGURED');
}));

test('a data dir that does not exist yet is created by the first write', () => {
  // Invariant: cc never creates the data dir, so the store creates it (and missing parents) on write.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-nodir-'));
  return withEnv({ CONDUCTOR_PLUGIN_DATA_DIR: path.join(tmp, 'a/b/code-review') }, () => {
    const review = { id: 'r-000000000a', rev: 1 };
    store.write(review);
    assert.ok(fs.existsSync(path.join(tmp, 'a/b/code-review/reviews/r-000000000a.json')));
  }).finally(() => fs.rmSync(tmp, { recursive: true, force: true }));
});

test('the change emitter has no listener cap, since every open SSE client is a listener', () => {
  assert.equal(store.changes.getMaxListeners(), 0);
});

test('ids lists id-named .json files without parsing them', () => {
  const { dir } = fresh();
  const good = store.newId();
  store.write({ id: good, rev: 0 });
  const bad = store.newId();
  fs.writeFileSync(path.join(dir, 'reviews', `${bad}.json`), '{ not json');
  fs.writeFileSync(path.join(dir, 'reviews', 'notes.txt'), 'x');
  fs.writeFileSync(path.join(dir, 'reviews', 'notes.json'), '{}');
  assert.deepEqual(store.ids().sort(), [good, bad].sort());
});

test('list skips and logs an unparsable file and a misfiled one, returning the readable reviews', (t) => {
  const { dir } = fresh();
  const errors = t.mock.method(console, 'error', () => {});
  const good = store.newId();
  store.write({ id: good, rev: 0 });
  const bad = store.newId();
  fs.writeFileSync(path.join(dir, 'reviews', `${bad}.json`), '{ not json');
  const misfiled = store.newId();
  fs.writeFileSync(path.join(dir, 'reviews', `${misfiled}.json`), JSON.stringify({ id: good, rev: 3 }));
  assert.deepEqual(store.list().map((r) => r.id), [good]);
  const logged = errors.mock.calls.map((c) => c.arguments[0]);
  assert.equal(logged.length, 2);
  assert.ok(logged.some((l) => l.includes(bad) && l.includes('SyntaxError')));
  assert.ok(logged.some((l) => l.includes(misfiled) && l.includes('MisfiledReview')));
});

test('reading a file whose content names another review, or no review, throws MisfiledReview', () => {
  const { dir } = fresh();
  const other = store.newId();
  const a = store.newId();
  const b = store.newId();
  fs.mkdirSync(path.join(dir, 'reviews'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'reviews', `${a}.json`), JSON.stringify({ id: other }));
  fs.writeFileSync(path.join(dir, 'reviews', `${b}.json`), 'null');
  assert.throws(() => store.read(a), { name: 'MisfiledReview' });
  assert.throws(() => store.read(b), { name: 'MisfiledReview' });
});

test('mutating a misfiled review writes nothing anywhere', async () => {
  const { dir } = fresh();
  const victim = store.newId();
  store.write({ id: victim, rev: 0, title: 'victim' });
  const copy = store.newId();
  fs.writeFileSync(path.join(dir, 'reviews', `${copy}.json`), JSON.stringify({ id: victim, rev: 0, title: 'copy' }));
  const before = fs.readdirSync(path.join(dir, 'reviews')).map((n) => [n, fs.readFileSync(path.join(dir, 'reviews', n), 'utf8')]);
  await assert.rejects(store.mutate(copy, (r) => { r.title = 'changed'; }), { name: 'MisfiledReview' });
  assert.deepEqual(fs.readdirSync(path.join(dir, 'reviews')).map((n) => [n, fs.readFileSync(path.join(dir, 'reviews', n), 'utf8')]), before);
});

test('logSkipped writes one line even when the id and the error carry newlines and control characters', (t) => {
  const errors = t.mock.method(console, 'error', () => {});
  store.logSkipped('r-1\nforged\u001b', 'skipped', new Error('bad\r\nline'));
  assert.equal(errors.mock.callCount(), 1);
  const line = errors.mock.calls[0].arguments[0];
  assert.doesNotMatch(line, /[\u0000-\u001f\u007f-\u009f]/);
  assert.equal(line, 'code-review: review r-1 forged skipped: Error: bad line');
});
