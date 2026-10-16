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

test('an unreadable review file fails the migration loudly', async () => {
  ts = tempStore();
  fs.mkdirSync(path.join(ts.dir, 'reviews'), { recursive: true });
  fs.writeFileSync(path.join(ts.dir, 'reviews', `${store.newId()}.json`), '{ not json');
  await assert.rejects(migrateStore(), SyntaxError);
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
