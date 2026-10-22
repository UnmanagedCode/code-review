import { ccFetch, unavailable } from './ccFetch.js';
import { Refusal } from './refusals.js';

// cc's own caps (same names in cc's src/hostExec.ts): a larger request is refused, so clamp.
export const EXEC_MAX_OUTPUT_BYTES = 128 * 1024 * 1024;
export const EXEC_MAX_TIMEOUT_MS = 600_000;

/** Refusal codes meaning "the system could not answer": callers degrade on these rather than read them as a missing checkout. */
export const UNREACHABLE = ['SYSTEM_UNREACHABLE', 'GIT_TIMEOUT', 'GIT_UNAVAILABLE'];

// cc's resolution and transport refusals: the system (or its target) cannot be asked.
const CC_UNREACHABLE = new Set(['SYSTEM_UNREACHABLE', 'REMOTE_NOT_FOUND', 'SYSTEM_NOT_REGISTERED', 'SYSTEM_NO_PROVIDER', 'SYSTEM_NO_REMOTES', 'SYSTEMS_UNAVAILABLE']);

const timeoutMs = () => {
  const n = Math.floor(Number(process.env.CODE_REVIEW_GIT_TIMEOUT_MS));
  return n > 0 ? Math.min(n, EXEC_MAX_TIMEOUT_MS) : 120_000;
};

/** Cache/identity key of a place: one path can exist on several systems. */
export const placeKey = (place) => JSON.stringify([place.system, place.remoteId, place.path]);

/**
 * Runs `argv` on `place`'s system through cc's `POST /api/exec` (form B, cwd `/`, argv form, base64 output).
 * Resolves {code, stdout: Buffer, stderr: Buffer} whatever the exit code; cc's refusals become code-review ones.
 * `stdin` (Buffer or string) is sent as bytes; absent means a closed stdin.
 * `readOnly` asserts the command writes nothing, and is the only thing that lets a connection failure be retried.
 */
export async function exec(place, argv, { env, stdin, maxOutputBytes, readOnly = false } = {}) {
  const limit = timeoutMs();
  const body = {
    system: place.system, cwd: '/', argv, encoding: 'base64', timeoutMs: limit,
    ...(place.remoteId != null ? { remoteId: place.remoteId } : {}),
    ...(env ? { env } : {}),
    ...(stdin !== undefined ? { stdinB64: Buffer.from(stdin).toString('base64') } : {}),
    ...(maxOutputBytes ? { maxOutputBytes: Math.min(maxOutputBytes, EXEC_MAX_OUTPUT_BYTES) } : {}),
  };
  // The deadline is past cc's own, so cc reports EXEC_TIMEOUT first; aborting the request kills the command. A timeout is never retried.
  const { res, text, attempts, started } = await ccFetch('/api/exec', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }, { timeoutMs: limit + Math.min(10_000, limit), retry: readOnly ? 'connection' : 'none' });
  const fail = (cause, reason) => unavailable({ route: 'POST /api/exec', started, attempts, cause, reason });
  let out = null;
  try { out = JSON.parse(text); } catch { /* handled below */ }
  if (res.status === 404 && !out?.code) {
    throw fail('HTTP 404', 'this code-conductor does not serve POST /api/exec; code-review needs a cc that does (restart cc after updating it)');
  }
  if (!out || typeof out !== 'object') throw fail('non-JSON body', `code-conductor /api/exec: HTTP ${res.status} with a non-JSON body`);
  if (res.status === 200) return { code: out.exitCode, stdout: Buffer.from(out.stdout ?? '', 'base64'), stderr: Buffer.from(out.stderr ?? '', 'base64') };
  const where = `${place.system}${place.remoteId ? `/${place.remoteId}` : ''}`;
  if (CC_UNREACHABLE.has(out.code)) throw new Refusal('SYSTEM_UNREACHABLE', `system ${where} is unreachable (${out.code}: ${out.error})`);
  if (out.code === 'EXEC_TIMEOUT') throw new Refusal('GIT_TIMEOUT', `${argv[0]} on ${where} did not finish within ${limit} ms`);
  if (out.code === 'EXEC_OUTPUT_TOO_LARGE') throw new Refusal('DIFF_TOO_LARGE', 'output exceeds the size limit');
  if (out.code === 'EXEC_SPAWN_FAILED') throw new Refusal('GIT_UNAVAILABLE', `${argv[0]} could not start on ${where} (${out.errno ?? 'unknown errno'})`);
  // Anything else (INVALID_ARGUMENT, CWD_NOT_ABSOLUTE, a 5xx) is a code-review bug: fail loudly.
  throw Object.assign(new Error(`code-conductor /api/exec answered HTTP ${res.status} ${out.code ?? ''}: ${out.error ?? text}`), { status: res.status, code: out.code });
}
