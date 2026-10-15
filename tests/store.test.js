import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
  const r = { schema: 1, id, rev: 0, title: 'x', nested: { a: [1, 2] } };
  store.write(r);
  const back = store.read(id);
  assert.deepEqual(back, { ...r, rev: 1 });
  assert.deepEqual(store.list().map((x) => x.id), [id]);
});

test('an atomic write leaves no temp file behind', () => {
  const { dir } = fresh();
  const id = store.newId();
  store.write({ schema: 1, id, rev: 0 });
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
    store.write({ schema: 1, id, rev: 0 });
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
  store.write({ schema: 1, id, rev: 0, items: [] });
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
  store.write({ schema: 1, id, rev: 0, n: 0 });
  const res = await store.mutate(id, (r) => { r.n = 9; return { ok: false, code: 'NOPE', reason: 'x' }; });
  assert.equal(res.code, 'NOPE');
  assert.equal(store.read(id).n, 0);
  assert.equal((await store.mutate('r-0000000000', () => ({}))).code, 'REVIEW_UNKNOWN');
});

test('a mutation that changes nothing writes nothing and does not bump rev', async () => {
  fresh();
  const id = store.newId();
  store.write({ schema: 1, id, rev: 0, n: 0 });
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

test('the default root is $PROJECTS_ROOT/.code-review', () => {
  const saved = { s: process.env.CODE_REVIEW_STORE, p: process.env.PROJECTS_ROOT };
  delete process.env.CODE_REVIEW_STORE;
  process.env.PROJECTS_ROOT = '/some/projects';
  try {
    assert.equal(storeRoot(), path.join('/some/projects', '.code-review'));
  } finally {
    if (saved.s !== undefined) process.env.CODE_REVIEW_STORE = saved.s;
    if (saved.p === undefined) delete process.env.PROJECTS_ROOT; else process.env.PROJECTS_ROOT = saved.p;
  }
});

test('an unset root refuses STORE_UNCONFIGURED', async () => {
  const saved = { s: process.env.CODE_REVIEW_STORE, p: process.env.PROJECTS_ROOT };
  delete process.env.CODE_REVIEW_STORE;
  delete process.env.PROJECTS_ROOT;
  try {
    assert.throws(() => storeRoot(), (e) => e instanceof Refusal && e.code === 'STORE_UNCONFIGURED');
    assert.equal((await attempt(() => store.list())).code, 'STORE_UNCONFIGURED');
  } finally {
    if (saved.s !== undefined) process.env.CODE_REVIEW_STORE = saved.s;
    if (saved.p !== undefined) process.env.PROJECTS_ROOT = saved.p;
  }
});

test('CODE_REVIEW_STORE takes precedence over $PROJECTS_ROOT', () => {
  const saved = { s: process.env.CODE_REVIEW_STORE, p: process.env.PROJECTS_ROOT };
  process.env.CODE_REVIEW_STORE = '/explicit/store';
  process.env.PROJECTS_ROOT = '/some/projects';
  try {
    assert.equal(storeRoot(), '/explicit/store');
  } finally {
    if (saved.s === undefined) delete process.env.CODE_REVIEW_STORE; else process.env.CODE_REVIEW_STORE = saved.s;
    if (saved.p === undefined) delete process.env.PROJECTS_ROOT; else process.env.PROJECTS_ROOT = saved.p;
  }
});

test('the change emitter has no listener cap, since every open SSE client is a listener', () => {
  assert.equal(store.changes.getMaxListeners(), 0);
});
