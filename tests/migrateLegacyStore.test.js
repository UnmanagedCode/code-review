import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrateLegacyStore } from '../src/migrateLegacyStore.js';
import { main, start } from '../server.js';
import * as store from '../src/store.js';

let root, env, legacy, target;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-legacy-'));
  target = path.join(root, '.code-conductor/plugins/data/code-review');
  env = { PROJECTS_ROOT: root, CONDUCTOR_PLUGIN_DATA_DIR: target };
  legacy = path.join(root, '.code-review');
  fs.mkdirSync(path.join(legacy, 'reviews'), { recursive: true });
  fs.mkdirSync(path.join(legacy, 'logs'));
  fs.writeFileSync(path.join(legacy, 'reviews/r-000000000a.json'), '{"id":"r-000000000a"}');
  fs.writeFileSync(path.join(legacy, 'logs/cc.log'), 'line\n');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

/** Every file under dir as relative path → contents, for byte comparisons. */
function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else out[path.relative(dir, p)] = fs.readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return out;
}
const quiet = (t) => t.mock.method(console, 'log', () => {});
const exdev = () => { throw Object.assign(new Error('x'), { code: 'EXDEV' }); };

test('the legacy store moves into the data dir with contents and mode intact', (t) => {
  // Invariant: one rename carries every file, byte-identical, and the dir mode; missing parents are created; success is logged.
  const log = t.mock.method(console, 'log', () => {});
  fs.chmodSync(legacy, 0o750);
  const before = snapshot(legacy);
  assert.equal(migrateLegacyStore({ env }), 'moved');
  assert.deepEqual(snapshot(target), before);
  assert.equal(fs.existsSync(legacy), false);
  assert.equal(fs.statSync(target).mode & 0o777, 0o750);
  assert.ok(log.mock.calls.some((c) => String(c.arguments[0]).includes(legacy) && String(c.arguments[0]).includes(target)));
});

test('a second run is a no-op that leaves the target untouched', (t) => {
  // Invariant: idempotent, since the legacy dir is gone after the move.
  quiet(t);
  migrateLegacyStore({ env });
  const after = snapshot(target);
  assert.equal(migrateLegacyStore({ env }), 'absent');
  assert.deepEqual(snapshot(target), after);
});

test('no legacy dir: absent, and no target or parents are created', () => {
  // Invariant: a fresh install creates nothing here.
  fs.rmSync(legacy, { recursive: true });
  assert.equal(migrateLegacyStore({ env }), 'absent');
  assert.equal(fs.existsSync(path.join(root, '.code-conductor')), false);
});

test('unset or empty PROJECTS_ROOT, or an unset or relative data dir, is unconfigured and moves nothing', () => {
  // Invariant: the move needs both variables, and the data dir must be absolute.
  const before = snapshot(legacy);
  for (const e of [{ ...env, PROJECTS_ROOT: undefined }, { ...env, PROJECTS_ROOT: '' }, { ...env, CONDUCTOR_PLUGIN_DATA_DIR: undefined }, { ...env, CONDUCTOR_PLUGIN_DATA_DIR: 'rel/dir' }]) {
    assert.equal(migrateLegacyStore({ env: e }), 'unconfigured');
  }
  assert.deepEqual(snapshot(legacy), before);
  assert.equal(fs.existsSync(path.join(root, '.code-conductor')), false);
});

test('an empty target dir is replaced by the legacy store', (t) => {
  // Invariant: an empty dir carries nothing to lose, so the move proceeds.
  quiet(t);
  fs.mkdirSync(target, { recursive: true });
  const before = snapshot(legacy);
  assert.equal(migrateLegacyStore({ env }), 'moved');
  assert.deepEqual(snapshot(target), before);
});

/** Asserts a refusal that names both paths, leaves the legacy dir byte-identical and puts nothing in the target. */
function refuses(opts, match) {
  const before = snapshot(legacy);
  const err = assert.throws(() => migrateLegacyStore({ env, ...opts }), (e) => {
    assert.ok(e.message.includes(legacy) && e.message.includes(target), e.message);
    assert.match(e.message, match);
    return true;
  });
  assert.equal(err, undefined);
  assert.deepEqual(snapshot(legacy), before);
}

test('a non-empty target refuses and keeps both stores', () => {
  // Invariant: two live stores are never merged or overwritten.
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'mine.txt'), 'keep');
  refuses({}, /is not empty/);
  assert.deepEqual(snapshot(target), { 'mine.txt': 'keep' });
});

test('a target that is a file refuses', () => {
  // Invariant: a non-directory target is never replaced.
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, 'file');
  refuses({}, /is not a directory/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'file');
});

test('a legacy path that is a file refuses', () => {
  // Invariant: only a real directory is moved.
  fs.rmSync(legacy, { recursive: true });
  fs.writeFileSync(legacy, 'file');
  assert.throws(() => migrateLegacyStore({ env }), (e) => e.message.includes(legacy) && e.message.includes(target) && /is not a directory/.test(e.message));
  assert.equal(fs.existsSync(target), false);
});

test('a legacy symlink to a dir refuses', () => {
  // Invariant: a symlink is not followed, so the dir it points at is never moved.
  const real = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-legacy-real-'));
  try {
    fs.rmSync(legacy, { recursive: true });
    fs.symlinkSync(real, legacy);
    assert.throws(() => migrateLegacyStore({ env }), (e) => e.message.includes(legacy) && e.message.includes(target) && /is not a directory/.test(e.message));
    assert.equal(fs.existsSync(target), false);
    assert.ok(fs.existsSync(real));
  } finally {
    fs.rmSync(real, { recursive: true, force: true });
  }
});

test('a cross-device rename refuses with the mv command and moves nothing', () => {
  // Invariant: EXDEV is never papered over with a copy; the operator is told the exact mv.
  refuses({ rename: exdev }, /different filesystems[\s\S]*mv '.*code-review'/);
  assert.equal(fs.existsSync(target), false);
});

test('any other rename error refuses and carries its cause', () => {
  // Invariant: unexpected fs errors fail loudly with the original error attached.
  const boom = Object.assign(new Error('denied'), { code: 'EACCES' });
  const err = (() => { try { migrateLegacyStore({ env, rename() { throw boom; } }); } catch (e) { return e; } })();
  assert.ok(err.message.includes(legacy) && err.message.includes(target) && err.message.includes('denied'));
  assert.equal(err.cause, boom);
  assert.ok(fs.existsSync(path.join(legacy, 'reviews/r-000000000a.json')));
});

/** Pre-lastActivityAt review, so migrateStore has something to backfill. */
function seedOldReview() {
  fs.writeFileSync(path.join(legacy, 'reviews/r-000000000a.json'), JSON.stringify({
    id: 'r-000000000a', project: 'app', worktree: null, status: 'open', createdAt: '2026-01-01T00:00:00.000Z', rev: 3, seq: 9, humanSeq: 0,
    rounds: [{ n: 1, createdAt: '2026-01-01T00:00:00.000Z', submittedAt: null }], verdicts: {}, threads: [], submissions: [],
  }));
}

/** Sets process.env to fixture values for the test; restores after. */
function useEnv(t) {
  const saved = { p: process.env.PROJECTS_ROOT, d: process.env.CONDUCTOR_PLUGIN_DATA_DIR };
  Object.assign(process.env, { PROJECTS_ROOT: env.PROJECTS_ROOT, CONDUCTOR_PLUGIN_DATA_DIR: env.CONDUCTOR_PLUGIN_DATA_DIR });
  t.after(() => {
    for (const [k, v] of [['PROJECTS_ROOT', saved.p], ['CONDUCTOR_PLUGIN_DATA_DIR', saved.d]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
}
const close = (server) => new Promise((r) => server.close(r));
const distDir = () => {
  const d = path.join(root, 'dist');
  fs.mkdirSync(d);
  fs.writeFileSync(path.join(d, 'index.html'), '<!doctype html>');
  return d;
};

test('main() moves the store before migrating review shapes, then listens', async (t) => {
  // Invariant: boot order is legacy move → migrateStore → listen; the moved review is in the store with backfilled fields.
  quiet(t);
  useEnv(t);
  seedOldReview();
  const server = await main({ port: 0, distDir: distDir() });
  t.after(() => close(server));
  assert.deepEqual(store.list().map((r) => r.id), ['r-000000000a']);
  const moved = JSON.parse(fs.readFileSync(path.join(target, 'reviews/r-000000000a.json'), 'utf8'));
  assert.equal(typeof moved.lastActivityAt, 'string');
  assert.equal(typeof moved.agentSeq, 'number');
  assert.equal(fs.existsSync(legacy), false);
});

test('main() rejects on a refusal and never listens', async (t) => {
  // Invariant: a refused move stops the boot instead of serving an empty store next to the real one.
  useEnv(t);
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'mine.txt'), 'keep');
  await assert.rejects(main({ port: 0, distDir: distDir() }), /is not empty/);
  assert.ok(fs.existsSync(path.join(legacy, 'reviews/r-000000000a.json')));
});

test('start() never moves a legacy store', async (t) => {
  // Invariant: only main() reads PROJECTS_ROOT, so in-process tests calling start() cannot touch a real store.
  useEnv(t);
  const server = await start({ port: 0, distDir: distDir() });
  t.after(() => close(server));
  assert.ok(fs.existsSync(path.join(legacy, 'reviews/r-000000000a.json')));
  assert.equal(fs.existsSync(target), false);
});
