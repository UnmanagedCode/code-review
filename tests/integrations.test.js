import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fakeCc } from './_fakeCc.js';
import { tempStore } from './_store.js';
import { start } from '../server.js';
import { attempt } from '../src/refusals.js';
import { CODE_GIT_PLUGIN, codeGitPlugin } from '../src/integrations.js';

// GET /api/integrations: whether "Open in code-git" may be offered, read from cc's plugin list.

let cc;
let store;
beforeEach(async () => {
  store = tempStore();
  process.env.CODE_REVIEW_CC_TIMEOUT_MS = '100';
  cc = await fakeCc();
});
afterEach(() => {
  cc.close();
  store.cleanup();
  delete process.env.CODE_REVIEW_CC_TIMEOUT_MS;
});

const row = (over = {}) => ({ id: CODE_GIT_PLUGIN, name: 'Code Git', enabled: true, hasFrontend: true, ...over });

test('an enabled code-git with a view is offered by its id', async () => {
  // Pins: the id comes from the matching row, and other plugins' rows are skipped.
  assert.equal(CODE_GIT_PLUGIN, 'code-git');
  cc.state.plugins = [{ id: 'code-review', enabled: true, hasFrontend: true }, row()];
  assert.deepEqual(await codeGitPlugin(), { id: 'code-git' });
});

test('a disabled, view-less or absent code-git is not offered', async () => {
  // Pins: each of `id`, `enabled` and `hasFrontend` is required; a link to a view cc would not open is never built.
  for (const plugins of [[row({ enabled: false })], [row({ hasFrontend: false })], [], [row({ id: 'code-gitx' })], [row({ id: null })]]) {
    cc.state.plugins = plugins;
    assert.equal(await codeGitPlugin(), null, JSON.stringify(plugins));
  }
});

test('cc failing to answer refuses CONDUCTOR_UNAVAILABLE rather than reporting code-git absent', async () => {
  // Pins: unreachable ≠ absent; the failure propagates as cc's usual refusal.
  cc.state.mode = 'error';
  const r = await attempt(() => codeGitPlugin());
  assert.equal(r.ok, false);
  assert.equal(r.code, 'CONDUCTOR_UNAVAILABLE');
});

test('GET /api/integrations serves the answer and the refusal', async () => {
  // Pins: the route wiring and its body shape `{ok, codeGit}`.
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-integ-dist-'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html>');
  const server = await start({ port: 0, distDir: dist });
  const url = `http://127.0.0.1:${server.address().port}/api/integrations`;
  try {
    cc.state.plugins = [row()];
    assert.deepEqual(await (await fetch(url)).json(), { ok: true, codeGit: { id: 'code-git' } });
    cc.state.plugins = [];
    assert.deepEqual(await (await fetch(url)).json(), { ok: true, codeGit: null });
    cc.state.mode = 'error';
    const res = await fetch(url);
    assert.equal(res.status, 502);
    assert.equal((await res.json()).code, 'CONDUCTOR_UNAVAILABLE');
  } finally {
    server.closeAllConnections();
    server.close();
    fs.rmSync(dist, { recursive: true, force: true });
  }
});
