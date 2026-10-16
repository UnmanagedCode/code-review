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

const submissionsSource = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'src', 'submissions.js'), 'utf8');
const backendBridgeCodes = [...(/BRIDGE_CODES\s*=\s*\[([^\]]*)\]/.exec(submissionsSource)?.[1] ?? '').matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);

test('the UI’s bridge codes are exactly the backend’s accepted set', () => {
  expect([...BRIDGE_CODES].sort()).toEqual([...backendBridgeCodes].sort());
});

test('the bridge codes are the seven cc defines', () => {
  expect([...BRIDGE_CODES].sort()).toEqual(['HOST_ERROR', 'INVALID_ARGUMENT', 'LOOKUP_FAILED', 'SEND_FAILED', 'SESSION_NOT_LIVE', 'SESSION_NOT_READY', 'SESSION_UNKNOWN']);
});
