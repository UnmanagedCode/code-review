import { Refusal } from './refusals.js';
import { logEvent } from './opsLog.js';

export const MAX_ATTEMPTS = 3;
export const DEFAULT_RETRY_MS = 1000;

// What a cc restart or a dropped connection raises; `UND_ERR_SOCKET` is undici's "other side closed", `UND_ERR_CONNECT_TIMEOUT` a connect that never completed (nothing was sent).
const CONNECTION_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT']);

// Base of the wait before a retry (times 3 per further retry); read on every call so tests and operators can change it.
const retryBaseMs = () => {
  const n = Math.floor(Number(process.env.CODE_REVIEW_CC_RETRY_MS));
  return n > 0 ? n : DEFAULT_RETRY_MS;
};

const isTimeout = (e) => e?.name === 'TimeoutError';
const isConnection = (e) => CONNECTION_CODES.has(e?.cause?.code ?? e?.code);
const causeOf = (e) => (isTimeout(e) ? 'TimeoutError' : e.cause?.code ?? e.cause?.name ?? e.code ?? e.name);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Logs the failure and returns the CONDUCTOR_UNAVAILABLE refusal for it; callers `throw` the result.
 * `attempts` is how many requests were made (0: none could be).
 */
export function unavailable({ route, started, attempts, cause, reason }) {
  logEvent({ at: new Date().toISOString(), code: 'CONDUCTOR_UNAVAILABLE', route, elapsedMs: Date.now() - started, attempts, cause, reason });
  return new Refusal('CONDUCTOR_UNAVAILABLE', attempts > 1 ? `${reason} (after ${attempts} attempts)` : reason);
}

/**
 * One HTTP exchange with cc: every attempt gets its own `timeoutMs` deadline.
 * `retry` (default 'none', so a caller that omits it never repeats a request) says which transport failures (never an HTTP answer) may be repeated, up to MAX_ATTEMPTS:
 * 'none'; 'connection' (refused, reset); 'transient' (those, plus a first timeout).
 * Resolves {res, text, attempts, started}; transport failure throws CONDUCTOR_UNAVAILABLE.
 */
export async function ccFetch(path, { method = 'GET', headers, body } = {}, { timeoutMs, retry = 'none' }) {
  const route = `${method} ${path}`;
  const started = Date.now();
  const base = process.env.CONDUCTOR_URL;
  if (!base) throw unavailable({ route, started, attempts: 0, cause: 'CONDUCTOR_URL unset', reason: 'CONDUCTOR_URL is not set: run inside code-conductor' });
  let timedOut = false;
  let lastError;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(base + path, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
      const text = await res.text();
      if (attempt > 1) logEvent({ at: new Date().toISOString(), outcome: 'recovered', route, elapsedMs: Date.now() - started, attempts: attempt, cause: causeOf(lastError) });
      return { res, text, attempts: attempt, started };
    } catch (e) {
      lastError = e;
      const retryable = retry !== 'none' && (isConnection(e) || (retry === 'transient' && isTimeout(e) && !timedOut));
      if (isTimeout(e)) timedOut = true;
      if (!retryable || attempt >= MAX_ATTEMPTS) {
        throw unavailable({ route, started, attempts: attempt, cause: causeOf(e), reason: `code-conductor ${method} ${path}: ${e.message}` });
      }
      await sleep(retryBaseMs() * 3 ** (attempt - 1));
    }
  }
}
