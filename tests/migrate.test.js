import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tempStore } from './_store.js';
import * as store from '../src/store.js';
import { SCHEMA, migrateStore } from '../src/migrate.js';
import { start } from '../server.js';

let ts;
afterEach(() => { ts?.cleanup(); ts = null; });

const thread = (id, extra = {}) => ({ id, status: 'open', anchor: { file: 'a.js', round: 2 }, messages: [], ...extra });
/** A review as schema 1 stored it: threads without `pastAnchors`. */
const legacy = (threads = [thread('t1'), thread('t2')]) => ({ schema: 1, id: store.newId(), rev: 0, threads });

test('a schema-1 review gains an empty pastAnchors on every thread and the current schema, nothing else changes', async () => {
  ts = tempStore();
  const r = legacy();
  store.write(r);
  await migrateStore();
  const back = store.read(r.id);
  assert.equal(SCHEMA, 2);
  assert.equal(back.schema, SCHEMA);
  assert.deepEqual(back.threads, r.threads.map((t) => ({ ...t, pastAnchors: [] })));
  assert.equal(back.rev, r.rev + 1, 'written once');
});

test('migrating twice writes nothing the second time', async () => {
  ts = tempStore();
  const r = legacy();
  store.write(r);
  await migrateStore();
  const once = store.read(r.id);
  await migrateStore();
  assert.deepEqual(store.read(r.id), once);
});

test('a review already at the current schema is untouched, its recorded positions kept', async () => {
  ts = tempStore();
  const r = { schema: SCHEMA, id: store.newId(), rev: 0, threads: [thread('t1', { pastAnchors: [{ file: 'a.js', round: 1 }] })] };
  store.write(r);
  const before = store.read(r.id);
  await migrateStore();
  assert.deepEqual(store.read(r.id), before);
});

test('a schema-1 thread that somehow already records positions keeps them: the migration never discards data', async () => {
  ts = tempStore();
  const kept = [{ file: 'a.js', round: 1 }];
  const r = legacy([thread('t1', { pastAnchors: kept }), thread('t2')]);
  store.write(r);
  await migrateStore();
  assert.deepEqual(store.read(r.id).threads.map((t) => t.pastAnchors), [kept, []]);
});

test('a schema-1 review with no threads is still stamped with the current schema', async () => {
  ts = tempStore();
  const r = legacy([]);
  store.write(r);
  await migrateStore();
  assert.equal(store.read(r.id).schema, SCHEMA);
});

test('an unconfigured store is skipped without throwing', async () => {
  const saved = { s: process.env.CODE_REVIEW_STORE, p: process.env.PROJECTS_ROOT };
  delete process.env.CODE_REVIEW_STORE;
  delete process.env.PROJECTS_ROOT;
  try {
    await migrateStore();
  } finally {
    if (saved.s !== undefined) process.env.CODE_REVIEW_STORE = saved.s;
    if (saved.p !== undefined) process.env.PROJECTS_ROOT = saved.p;
  }
});

const corrupt = (dir, text = '{ not json') => {
  const id = store.newId();
  fs.mkdirSync(path.join(dir, 'reviews'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'reviews', `${id}.json`), text);
  return { id, file: path.join(dir, 'reviews', `${id}.json`), text };
};

test('an unparsable review is logged and left as it is, still failing loudly when read; the others migrate', async (t) => {
  ts = tempStore();
  const errors = t.mock.method(console, 'error', () => {});
  const bad = corrupt(ts.dir);
  const good = legacy();
  store.write(good);
  await migrateStore();
  assert.equal(store.read(good.id).schema, SCHEMA);
  assert.equal(fs.readFileSync(bad.file, 'utf8'), bad.text, 'the unreadable file is not touched');
  assert.throws(() => store.read(bad.id), SyntaxError);
  assert.equal(errors.mock.callCount(), 1);
  assert.match(errors.mock.calls[0].arguments[0], new RegExp(bad.id));
});

test('a parse error is logged on one line, without the file\'s newlines or control characters', async (t) => {
  ts = tempStore();
  const errors = t.mock.method(console, 'error', () => {});
  const text = '[1,\n\u001b\rforged\n]';
  assert.throws(() => JSON.parse(text), (e) => /\n/.test(e.message) && e.message.includes('\u001b'), 'precondition: the raw message quotes the file');
  corrupt(ts.dir, text);
  await migrateStore();
  assert.equal(errors.mock.callCount(), 1);
  const line = errors.mock.calls[0].arguments[0];
  assert.match(line, /SyntaxError/);
  assert.doesNotMatch(line, /[\u0000-\u001f\u007f-\u009f]/);
});

const filesOf = (dir) => Object.fromEntries(fs.readdirSync(path.join(dir, 'reviews')).map((n) => [n, fs.readFileSync(path.join(dir, 'reviews', n), 'utf8')]));

test('a file whose content names another review is logged and never written over that review, even through start()', async (t) => {
  ts = tempStore();
  const errors = t.mock.method(console, 'error', () => {});
  const victim = legacy([thread('t1')]);
  store.write(victim);
  await migrateStore(); // the victim is current; the copy below would have to overwrite it to change it
  const copyId = store.newId();
  fs.writeFileSync(path.join(ts.dir, 'reviews', `${copyId}.json`), JSON.stringify({ ...legacy([thread('t9')]), id: victim.id }));
  const before = filesOf(ts.dir);
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-migrate-dist-'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html>');
  const server = await start({ port: 0, distDir: dist });
  try {
    assert.deepEqual(filesOf(ts.dir), before, 'neither file changed');
    assert.equal(errors.mock.callCount(), 1);
    assert.match(errors.mock.calls[0].arguments[0], new RegExp(`${copyId}.*MisfiledReview`));
  } finally {
    server.close();
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

test('a file whose content names a review that does not exist creates no review', async (t) => {
  ts = tempStore();
  t.mock.method(console, 'error', () => {});
  const copyId = store.newId();
  const ghost = store.newId();
  fs.mkdirSync(path.join(ts.dir, 'reviews'), { recursive: true });
  fs.writeFileSync(path.join(ts.dir, 'reviews', `${copyId}.json`), JSON.stringify({ ...legacy(), id: ghost }));
  const before = filesOf(ts.dir);
  await migrateStore();
  assert.deepEqual(filesOf(ts.dir), before);
  assert.equal(fs.existsSync(path.join(ts.dir, 'reviews', `${ghost}.json`)), false);
});

test('a review whose shape cannot be migrated is logged and left unmigrated', async (t) => {
  ts = tempStore();
  const errors = t.mock.method(console, 'error', () => {});
  const odd = { schema: 1, id: store.newId(), rev: 0, threads: null };
  store.write(odd);
  const before = fs.readFileSync(path.join(ts.dir, 'reviews', `${odd.id}.json`), 'utf8');
  await migrateStore();
  assert.equal(fs.readFileSync(path.join(ts.dir, 'reviews', `${odd.id}.json`), 'utf8'), before);
  assert.equal(errors.mock.callCount(), 1);
  assert.match(errors.mock.calls[0].arguments[0], new RegExp(odd.id));
});

test('start() still serves when one review cannot be migrated', async (t) => {
  ts = tempStore();
  t.mock.method(console, 'error', () => {});
  corrupt(ts.dir);
  const good = legacy();
  store.write(good);
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-migrate-dist-'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html>');
  const server = await start({ port: 0, distDir: dist });
  try {
    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/health`)).status, 200);
    assert.equal(store.read(good.id).schema, SCHEMA);
  } finally {
    server.close();
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

test('start() migrates the store before it serves', async () => {
  ts = tempStore();
  const r = legacy();
  store.write(r);
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-migrate-dist-'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html>');
  const server = await start({ port: 0, distDir: dist });
  try {
    const back = store.read(r.id);
    assert.equal(back.schema, SCHEMA);
    assert.ok(back.threads.every((t) => Array.isArray(t.pastAnchors)));
  } finally {
    server.close();
    fs.rmSync(dist, { recursive: true, force: true });
  }
});
