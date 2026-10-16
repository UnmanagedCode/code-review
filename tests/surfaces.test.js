import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'conductor.plugin.json'), 'utf8'));
const tools = new Set(manifest.mcp.tools.map((t) => t.name));
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const surfaces = {
  skill: read('skills', 'review-dialog', 'SKILL.md'),
  convention: read(manifest.conventions.find((c) => c.scope === 'conductor').file),
};
// cc tools the conductor convention may name besides this plugin's own.
const HOST_TOOLS = new Set(['merge_worktree']);

const toolLike = (text) => [...text.matchAll(/`([a-z]+(?:_[a-z]+)+)\b[^`]*`/g)].map((m) => m[1]);

test('every code-review__<tool> a prompt surface names is a manifest tool', () => {
  for (const [name, text] of Object.entries(surfaces)) {
    for (const m of text.matchAll(/code-review__([a-z_]+)/g)) assert.ok(tools.has(m[1]), `${name}: ${m[1]}`);
  }
});

test('every backticked tool name in the skill and convention is a manifest tool or a known cc tool', () => {
  for (const [name, text] of Object.entries(surfaces)) {
    for (const t of toolLike(text)) assert.ok(tools.has(t) || HOST_TOOLS.has(t), `${name}: ${t}`);
  }
});

test('no prompt surface offers a tool for setting a verdict', () => {
  for (const [name, text] of Object.entries(surfaces)) {
    assert.ok(!toolLike(text).some((t) => /verdict|accept|reject/.test(t)), name);
  }
});

test('the skill and the tool descriptions do not repeat each other: the skill cites no mechanics the tools already state', () => {
  assert.doesNotMatch(surfaces.skill, /severity|path#L/);
});
