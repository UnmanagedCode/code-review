// The read-only invariant over REST and MCP: no read touches a reviewed checkout. For every review kind on a main
// checkout and a linked worktree, every read route (and the store-only writes, which read the tree too) leaves the
// whole tree — working files, directories and `.git`, the common git dir included — byte- and mtime-identical,
// and leaves nothing in the system's TMPDIR.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { world, editLines } from './_world.js';
import { lines } from './_git.js';
import { tempStore } from './_store.js';
import { start } from '../server.js';

let server;
let base;
let dist;
let bootStore;
let w;
const cleanups = [];
before(async () => {
  bootStore = tempStore();
  dist = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-ro-dist-'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html>');
  server = await start({ port: 0, distDir: dist });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => {
  server.closeAllConnections();
  server.close();
  fs.rmSync(dist, { recursive: true, force: true });
  bootStore.cleanup();
});
afterEach(() => { w?.cleanup(); w = null; while (cleanups.length) cleanups.pop()(); });

const call = async (method, url, body) => {
  const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json();
  assert.ok(res.status < 300, `${method} ${url}: ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  return json;
};
const mcp = async (tool, args) => {
  const out = await call('POST', '/mcp', { tool, arguments: args, caller: { sessionId: 's-agent', project: 'app' } });
  assert.ok(!out.error && out.result?.ok !== false, `${tool}: ${JSON.stringify(out).slice(0, 300)}`);
  return out;
};

/** Path → content hash, size and mtime of every file, and path → mtime of every directory, under `dir` (symlinks not followed). */
function treeSig(dir) {
  const out = {};
  const walk = (p) => {
    const s = fs.lstatSync(p);
    const rel = path.relative(dir, p) || '.';
    if (s.isDirectory()) {
      out[`${rel}/`] = s.mtimeMs;
      for (const name of fs.readdirSync(p)) walk(path.join(p, name));
    } else {
      const bytes = s.isSymbolicLink() ? Buffer.from(fs.readlinkSync(p)) : fs.readFileSync(p);
      out[rel] = `${createHash('sha256').update(bytes).digest('hex')} ${s.size} ${s.mtimeMs}`;
    }
  };
  walk(dir);
  return out;
}

/** A dirty checkout: tracked edits, a restaged `rm --cached` path, untracked files, a stat-dirty file. */
function dirty(co) {
  co.commit({ 'r.txt': 'r1\n', 'c.txt': lines(5, 'c') });
  co.git('rm', '--cached', '-q', 'r.txt');
  co.write('r.txt', 'r2\n');
  co.write('a.js', editLines({ 4: 'live-4' }));
  co.write('u1.txt', 'u1\n');
  const future = new Date(Date.now() + 5000);
  fs.utimesSync(path.join(co.dir, 'b.js'), future, future);
}

for (const where of ['main', 'worktree']) {
  test(`every read route leaves the ${where} checkout, its git dirs and TMPDIR untouched, for range, commit and uncommitted reviews`, async () => {
    w = await world();
    w.session('s-agent');
    const first = w.repo.git('rev-parse', 'HEAD');
    const co = where === 'main' ? w.repo : w.addWorktree();
    const worktree = where === 'main' ? null : 'feature';
    co.commit({ 'a.js': editLines({ 2: 'two' }), 'n.js': 'n1\nn2\n' });
    const ids = {};
    for (const kind of ['range', 'commit', 'uncommitted']) {
      ids[kind] = (await call('POST', '/reviews', { project: 'app', worktree, kind, ...(kind === 'range' ? { base: first } : {}) })).review.id;
    }
    // A second range round, so comparisons and past rounds have something to read.
    co.commit({ 'b.js': editLines({ 3: 'b-three' }, 10) });
    await call('POST', `/reviews/${ids.range}/refresh`, {});
    const roundTwoHead = co.git('rev-parse', 'HEAD');
    dirty(co);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-ro-tmp-'));
    cleanups.push(() => fs.rmSync(tmp, { recursive: true, force: true }));
    w.cc.state.execEnv = { TMPDIR: tmp };
    const roots = [w.repo.dir, ...(where === 'worktree' ? [co.dir] : [])];
    const sig = () => roots.map(treeSig);
    const before = sig();

    for (const [kind, id] of Object.entries(ids)) {
      const line = kind === 'uncommitted' ? 4 : 2;
      const t = (await call('POST', `/reviews/${id}/threads`, { anchor: { file: 'a.js', side: 'new', startLine: line }, kind: 'comment', body: 'see n.js#L1' })).thread;
      await call('POST', `/reviews/${id}/threads/${t.id}/messages`, { body: 'and a.js#L1-L2' });
      await call('PATCH', `/reviews/${id}/threads/${t.id}`, { status: 'resolved' });
      await call('GET', `/reviews/${id}`);
      const diff = await call('GET', `/reviews/${id}/diff`);
      await call('GET', `/reviews/${id}/diff?file=a.js`);
      await call('GET', `/reviews/${id}/file?path=a.js&side=new`);
      await call('GET', `/reviews/${id}/file?path=a.js&side=old&start=1&end=2`);
      await call('GET', `/reviews/${id}/commits`);
      await mcp('get_review', { review: id });
      await mcp('list_threads', { review: id, status: 'all' });
      await mcp('get_hunk', { review: id, file: 'a.js' });
      if (kind !== 'uncommitted') {
        const hunk = diff.files.find((f) => f.path === 'a.js').hunks[0].id;
        await call('PUT', `/reviews/${id}/hunks/${hunk}/verdict`, { verdict: 'accepted' });
        await call('POST', `/reviews/${id}/accept-file`, { file: 'a.js', hunkIds: [hunk] });
      }
      if (kind === 'range') {
        await call('GET', `/reviews/${id}/rounds/1`);
        await call('GET', `/reviews/${id}/diff?round=1`);
        await call('GET', `/reviews/${id}/compare?from=1&to=2`);
        await call('GET', `/reviews/${id}/diff?commit=${roundTwoHead}`);
      }
    }
    await call('GET', '/reviews?project=app');
    await call('GET', '/inbox');
    await call('GET', `/checkout?project=app${worktree ? `&worktree=${worktree}` : ''}`);
    await call('GET', `/checkout/commits?project=app${worktree ? `&worktree=${worktree}` : ''}`);
    await call('GET', '/projects');

    assert.deepEqual(sig(), before);
    assert.deepEqual(fs.readdirSync(tmp), [], 'no private dir left in TMPDIR');
  });
}

for (const packed of [false, true]) {
  test(`reading an uncommitted review with an unchanged restaged path (rm --cached, file byte-identical) leaves .git untouched, its blob ${packed ? 'packed' : 'loose'}`, async () => {
    // Invariant: restaging a path whose blob is already in the real object store neither writes nor freshens it (no loose object or pack mtime moves): blobs are written only to the private dir.
    w = await world();
    w.repo.commit({ 'r.txt': 'unchanged\n', 's.txt': 's1\n' });
    if (packed) w.repo.git('gc', '-q');
    w.repo.git('rm', '--cached', '-q', 'r.txt', 's.txt');
    w.repo.write('s.txt', 's2\n'); // a changed restage beside it
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-ro-tmp-'));
    cleanups.push(() => fs.rmSync(tmp, { recursive: true, force: true }));
    w.cc.state.execEnv = { TMPDIR: tmp };
    // Age everything in the object store, so a freshen (utime to now) cannot land on the same timestamp.
    const old = new Date('2020-01-01T00:00:00Z');
    const age = (p) => { for (const e of fs.readdirSync(p, { withFileTypes: true })) { const q = path.join(p, e.name); if (e.isDirectory()) age(q); else fs.utimesSync(q, old, old); } };
    age(path.join(w.repo.dir, '.git', 'objects'));
    const before = treeSig(w.repo.dir);
    const { review } = await call('POST', '/reviews', { project: 'app', kind: 'uncommitted' });
    const got = await call('GET', `/reviews/${review.id}`);
    assert.deepEqual(got.files.map((f) => f.path), ['s.txt'], 'the unchanged path has no entry; the changed one is modified');
    await call('GET', `/reviews/${review.id}/diff`);
    await call('GET', '/reviews?project=app');
    assert.deepEqual(treeSig(w.repo.dir), before);
    assert.deepEqual(fs.readdirSync(tmp), []);
  });
}
