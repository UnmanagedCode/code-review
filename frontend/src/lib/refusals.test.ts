import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { BRIDGE_CODES, bridgeMessage, errorText, messageFor, UNREACHABLE } from './refusals';

const backendSource = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'src', 'refusals.js'), 'utf8');
const codes = [...backendSource.slice(0, backendSource.indexOf('};')).matchAll(/\b([A-Z][A-Z_]+):\s*\d{3}/g)].map((m) => m[1]);

test('the backend code list was read from source', () => {
  expect(codes.length).toBeGreaterThan(30);
  expect(codes).toContain('THREAD_DROPPED');
});

test('every backend refusal code except the MCP-only one, and INTERNAL, has a specific message', () => {
  for (const code of [...codes.filter((c) => c !== 'CALLER_UNKNOWN'), 'INTERNAL']) {
    expect(messageFor(code), code).not.toMatch(/^Unexpected refusal/);
  }
});

test('every bridge code has its own message; an unknown one is echoed raw', () => {
  for (const c of BRIDGE_CODES) expect(bridgeMessage(c)).not.toContain('unrecognised');
  expect(bridgeMessage('NEW_CODE')).toContain('NEW_CODE');
});

test('a missing code reads as an unreachable backend; reasons are appended only where they add detail', () => {
  expect(messageFor(undefined)).toBe(UNREACHABLE);
  expect(messageFor('INTERNAL', 'boom')).toContain('boom');
  expect(messageFor('REVIEW_CLOSED', 'x')).not.toContain('x');
  expect(errorText(new Error('network'))).toBe(UNREACHABLE);
});
