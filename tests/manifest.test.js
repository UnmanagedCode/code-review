import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'conductor.plugin.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

// Mirrors cc's manifest validation: a tool property may only use these keys and may not nest a schema.
const ALLOWED_PROP_KEYS = new Set(['type', 'description', 'enum', 'minLength', 'maxLength', 'pattern', 'minimum', 'maximum', 'items', 'default']);
const FORBIDDEN = ['$ref', 'oneOf', 'anyOf', 'allOf', 'not'];

test('manifest identity and version match package.json', () => {
  assert.equal(manifest.id, 'code-review');
  assert.equal(manifest.pluginApi, 1);
  assert.equal(manifest.version, pkg.version);
});

test('mcp block: endpoint /api/mcp and a non-empty tools array (cc rejects an empty one)', () => {
  assert.equal(manifest.mcp.endpoint, '/api/mcp');
  assert.ok(Array.isArray(manifest.mcp.tools) && manifest.mcp.tools.length > 0);
  assert.equal(new Set(manifest.mcp.tools.map((t) => t.name)).size, manifest.mcp.tools.length, 'tool names are unique');
});

test('every tool schema stays inside the flat subset and its defaults, enums and required names are coherent', () => {
  for (const tool of manifest.mcp.tools) {
    assert.ok(tool.name && tool.description && tool.inputSchema, `${tool.name} well-formed`);
    const schema = tool.inputSchema;
    assert.equal(schema.type, 'object', `${tool.name} root is an object`);
    for (const bad of FORBIDDEN) assert.equal(JSON.stringify(schema).includes(`"${bad}"`), false, `${tool.name} avoids ${bad}`);
    for (const [prop, def] of Object.entries(schema.properties)) {
      for (const key of Object.keys(def)) assert.ok(ALLOWED_PROP_KEYS.has(key), `${tool.name}.${prop} uses allowed key ${key}`);
      assert.equal('properties' in def, false, `${tool.name}.${prop} is not nested`);
      if (def.enum && 'default' in def) assert.ok(def.enum.includes(def.default), `${tool.name}.${prop} default is in its enum`);
    }
    for (const r of schema.required ?? []) assert.ok(r in schema.properties, `${tool.name} requires a declared property ${r}`);
  }
});

test('every tool except open_review requires `review`', () => {
  for (const tool of manifest.mcp.tools.filter((t) => t.name !== 'open_review')) {
    assert.ok(tool.inputSchema.required.includes('review'), tool.name);
  }
});

test('annotate requires `anchor`, one of lines, hunk, file and review', () => {
  // Invariant: the schema makes agents name the anchor kind, from exactly the kinds buildAnchor takes.
  const schema = manifest.mcp.tools.find((t) => t.name === 'annotate').inputSchema;
  assert.ok(schema.required.includes('anchor'));
  assert.deepEqual(schema.properties.anchor.enum, ['lines', 'hunk', 'file', 'review']);
});

test('annotate declares no default for side, so no client adds one to a file or review anchor', () => {
  // Invariant: the server owns the lines-only side default; a schema default applied client-side would refuse every file and review annotate.
  const schema = manifest.mcp.tools.find((t) => t.name === 'annotate').inputSchema;
  for (const [prop, def] of Object.entries(schema.properties)) assert.equal('default' in def, false, `annotate.${prop}`);
});

test('the conductor-scope convention declares an existing file; a missing one would make the plugin invalid', () => {
  const conv = manifest.conventions.find((c) => c.scope === 'conductor');
  assert.ok(conv, 'a conductor-scope convention exists');
  assert.ok(fs.existsSync(path.join(ROOT, conv.file)), conv.file);
});

test('the review-dialog skill exists with its name in the frontmatter', () => {
  const skill = fs.readFileSync(path.join(ROOT, 'skills', 'review-dialog', 'SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: review-dialog\n/);
});

test('the open_review schema has no recipient property and has author', () => {
  const props = manifest.mcp.tools.find((t) => t.name === 'open_review').inputSchema.properties;
  assert.equal('recipient' in props, false);
  assert.equal(props.author.type, 'string');
});
