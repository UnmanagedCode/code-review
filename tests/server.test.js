import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { start, CSP } from '../server.js';
import { tempStore } from './_store.js';

let dist;
let server;
let base;
let bootStore;

before(async () => {
  bootStore = tempStore(); // keep the API off a real store
  dist = fs.mkdtempSync(path.join(os.tmpdir(), 'code-review-dist-'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>Code Review</title><!-- app-shell -->');
  server = await start({ port: 0, distDir: dist });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(dist, { recursive: true, force: true });
  bootStore.cleanup();
});

test('health answers ok', async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test('host URLs 404 standalone instead of falling back to the page', async () => {
  for (const p of ['/pluginBridge.js', '/pluginTheme.css']) {
    const res = await fetch(base + p);
    assert.equal(res.status, 404, p);
    assert.doesNotMatch(await res.text(), /app-shell/, p);
  }
});

test('reserved /api answers 404 JSON, not the page', async () => {
  const res = await fetch(`${base}/api/anything`);
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type'), /json/);
});

test('static pages carry the CSP', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-security-policy'), CSP);
});

test('binds loopback only', () => {
  assert.equal(server.address().address, '127.0.0.1');
});

test('an unbuilt UI answers 503 with a hint', async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'code-review-empty-'));
  const quiet = console.error;
  console.error = () => {};
  const s = await start({ port: 0, distDir: empty });
  console.error = quiet;
  try {
    const res = await fetch(`http://127.0.0.1:${s.address().port}/`);
    assert.equal(res.status, 503);
    assert.match(await res.text(), /npm install/);
  } finally {
    s.close();
    fs.rmSync(empty, { recursive: true, force: true });
  }
});
