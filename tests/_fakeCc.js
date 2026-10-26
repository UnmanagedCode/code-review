import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

// The subset of cc's POST /api/exec contract (cc docs/plugins.md → "Host exec") code-review uses, validated as strictly.
const KEYS = new Set(['project', 'worktree', 'system', 'remoteId', 'cwd', 'argv', 'shell', 'env', 'stdin', 'stdinB64', 'timeoutMs', 'encoding', 'maxOutputBytes']);
const MAX_TIMEOUT_MS = 600_000;
const MAX_OUTPUT_BYTES = 128 * 1024 * 1024;
const DEFAULT_OUTPUT_BYTES = 64 * 1024 * 1024;
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const B64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

class Answer extends Error {
  constructor(status, body) { super(body.error); this.status = status; this.body = body; }
}
const invalid = (error) => new Answer(400, { error: `exec: ${error}`, code: 'INVALID_ARGUMENT' });
const bounded = (v, name, max, dflt) => {
  if (v === undefined) return dflt;
  if (!Number.isInteger(v) || v <= 0 || v > max) throw invalid(`${name} must be a positive integer no greater than ${max}`);
  return v;
};

function parse(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid('the body must be a JSON object');
  for (const k of Object.keys(body)) if (!KEYS.has(k)) throw invalid(`unknown field ${JSON.stringify(k)}`);
  if (body.project !== undefined || body.worktree !== undefined) throw invalid('form A is not used by code-review');
  if (typeof body.system !== 'string' || !body.system) throw invalid('system must be a non-empty string');
  if (body.remoteId !== undefined && body.remoteId !== null && typeof body.remoteId !== 'string') throw invalid('remoteId must be a string');
  const remoteId = body.remoteId === '' || body.remoteId === undefined ? null : body.remoteId;
  if (body.system === 'local' && remoteId !== null) throw invalid("system 'local' has no targets — remoteId must be absent");
  if (typeof body.cwd !== 'string' || !body.cwd) throw invalid('cwd is required with system');
  if (!path.isAbsolute(body.cwd)) throw new Answer(400, { error: 'exec: cwd must be absolute', code: 'CWD_NOT_ABSOLUTE' });
  if ((body.argv !== undefined) === (body.shell !== undefined)) throw invalid('give exactly one of argv and shell');
  if (body.shell !== undefined) throw invalid('shell form is not used by code-review');
  const { argv } = body;
  if (!Array.isArray(argv) || !argv.length || argv.some((a) => typeof a !== 'string' || a.includes('\0')) || !argv[0]) throw invalid('argv must be a non-empty array of strings without NUL');
  if (body.env !== undefined) {
    if (!body.env || typeof body.env !== 'object' || Array.isArray(body.env)) throw invalid('env must be an object of string values');
    for (const [k, v] of Object.entries(body.env)) {
      if (!ENV_NAME_RE.test(k)) throw invalid(`env name ${JSON.stringify(k)}`);
      if (typeof v !== 'string' || v.includes('\0')) throw invalid(`env value for ${k} must be a string without NUL`);
    }
  }
  if (body.stdin !== undefined && body.stdinB64 !== undefined) throw invalid('give at most one of stdin and stdinB64');
  if (body.stdin !== undefined && typeof body.stdin !== 'string') throw invalid('stdin must be a string');
  if (body.stdinB64 !== undefined && (typeof body.stdinB64 !== 'string' || !B64_RE.test(body.stdinB64))) throw invalid('stdinB64 must be strict base64');
  if (body.encoding !== undefined && !['utf8', 'base64'].includes(body.encoding)) throw invalid("encoding must be 'utf8' or 'base64'");
  return {
    system: body.system, remoteId, cwd: body.cwd, argv, env: body.env ?? {},
    stdin: body.stdinB64 !== undefined ? Buffer.from(body.stdinB64, 'base64') : body.stdin !== undefined ? Buffer.from(body.stdin, 'utf8') : null,
    encoding: body.encoding ?? 'utf8',
    timeoutMs: bounded(body.timeoutMs, 'timeoutMs', MAX_TIMEOUT_MS, 120_000),
    maxOutputBytes: bounded(body.maxOutputBytes, 'maxOutputBytes', MAX_OUTPUT_BYTES, DEFAULT_OUTPUT_BYTES),
  };
}

/** Rewrites a virtual root (`/cr-remote-…`, absent locally) to the real dir backing it. */
const remap = (sys) => (s) => (sys && (s === sys.root || s.startsWith(sys.root + '/')) ? sys.dir + s.slice(sys.root.length) : s);

function run(state, spec, req, res) {
  let sys = null;
  if (spec.system !== 'local') {
    sys = state.systems[spec.system];
    if (!sys) throw new Answer(501, { error: `system ${spec.system} is not registered`, code: 'SYSTEM_NOT_REGISTERED' });
    if ((sys.remoteId ?? null) !== spec.remoteId) throw new Answer(502, { error: `no remote ${spec.remoteId}`, code: 'REMOTE_NOT_FOUND' });
  }
  const map = remap(sys);
  const env = { ...process.env, ...state.execEnv };
  for (const [k, v] of Object.entries(spec.env)) env[k] = map(v);
  const started = Date.now();
  const child = spawn(spec.argv[0], spec.argv.slice(1).map(map), { cwd: map(spec.cwd), env });
  const out = [];
  const err = [];
  let bytes = 0;
  let done = false;
  const finish = (status, body) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(body));
  };
  const timer = setTimeout(() => {
    child.kill('SIGKILL');
    finish(504, { error: 'exec: timed out', code: 'EXEC_TIMEOUT', stdout: '', stderr: '', encoding: spec.encoding, durationMs: Date.now() - started });
  }, spec.timeoutMs);
  const collect = (into) => (chunk) => {
    bytes += chunk.length;
    if (bytes > spec.maxOutputBytes) {
      child.kill('SIGKILL');
      return finish(422, { error: 'exec: output too large', code: 'EXEC_OUTPUT_TOO_LARGE', limitBytes: spec.maxOutputBytes });
    }
    into.push(chunk);
  };
  child.stdout.on('data', collect(out));
  child.stderr.on('data', collect(err));
  child.on('error', (e) => finish(422, { error: `exec: ${e.message}`, code: 'EXEC_SPAWN_FAILED', errno: e.code ?? null }));
  child.on('close', (code, signal) => finish(200, {
    exitCode: code ?? (signal ? 128 : 1), stdout: Buffer.concat(out).toString(spec.encoding), stderr: Buffer.concat(err).toString(spec.encoding),
    encoding: spec.encoding, durationMs: Date.now() - started, system: spec.system, remoteId: spec.remoteId, cwd: spec.cwd,
  }));
  child.stdin.on('error', () => {}); // the command may exit before reading stdin
  child.stdin.end(spec.stdin ?? undefined);
  res.on('close', () => { if (!done) { done = true; clearTimeout(timer); child.kill('SIGKILL'); } }); // a disconnecting client kills the command
}

/**
 * A fake cc REST host. `fixture` is mutable: {projects, worktrees:{project:[rows]}, instances (null = the route answers 500), conductorProjects:{rootSessionId:[{project, lastSpawnAt, worktrees}]} (null = a cc without the route: 404), plugins (`GET /api/plugins` rows, served as `{rows, notices: []}`), systems, execEnv, execHook, mode, displayLabel}.
 * `mode` is 'ok' | 'error' | 'hang'. Sets CONDUCTOR_URL; `close()` restores it.
 * `GET /api/instances` fills each row's `displayLabel` that is absent or null with a stand-in, `title || firstPrompt || <id prefix>…`.
 * That is not cc's rule (cc gives `(new session)`, never the id prefix, for a session with no title or prompt):
 * a test that asserts a label sets `displayLabel` on its row. `displayLabel: false` sends rows without the field,
 * as a cc that does not serve it. Rows are copied, so `instances` stays as the test wrote it.
 * `POST /api/exec` runs the command for real on this machine. `systems` maps a non-local system id to
 * `{root, dir, remoteId?}`: argv elements, cwd and env values under the virtual `root` run under `dir`.
 * Every exec body lands in `execCalls`; `execHook(body)` may answer instead: `{status, body}`, `{status, raw}` (a non-JSON body), `'hang'` or `'reset'` (the connection is destroyed unanswered).
 * `state.hits` lists every request as `"<METHOD> <pathname>"`, hang and error modes included.
 * `state.resetNext` (a count, `Infinity` = always) makes GET routes destroy the connection unanswered while it is above 0, counting down;
 * `state.delayMs` makes GET routes answer after that many milliseconds (a function of the pathname: per route).
 * `state.getHook(pathname)` may answer a GET instead: `{status, body}`.
 * `GET /api/projects/:name/location` answers `{name, path, system, remoteId}` from `projects` (`system` absent = `local`,
 * `remoteId` absent = null), or 404 `PROJECT_UNKNOWN`.
 * `state.execDelayMs` delays every exec answer; `state.execInFlight` counts exec requests not yet answered and
 * `state.execMaxInFlight` the most there ever were at once.
 * Sets `CODE_REVIEW_CC_RETRY_MS` to 1 unless already set, so retries are instant, `CODE_REVIEW_LOOKUP_TTL_MS` to 0 unless
 * already set, so every request asks this fake afresh, and, when `CODE_REVIEW_STORE` is unset, points it at a temp dir
 * so the operator log never lands in a real store; `close()` restores them and removes only a dir it made.
 */
export async function fakeCc(fixture = {}) {
  const state = { projects: [], worktrees: {}, instances: [], conductorProjects: {}, plugins: [], systems: {}, execEnv: {}, execHook: null, execCalls: [], hits: [], resetNext: 0, delayMs: 0, getHook: null, execDelayMs: 0, execInFlight: 0, execMaxInFlight: 0, mode: 'ok', displayLabel: true, ...fixture };
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    state.hits.push(`${req.method} ${new URL(req.url, 'http://x').pathname}`);
    if (state.mode === 'hang') return;
    if (state.mode === 'error') { res.statusCode = 500; return res.end('{}'); }
    const url = new URL(req.url, 'http://x');
    const reply = (body, status = 200) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
    const delay = req.method === 'GET' ? (typeof state.delayMs === 'function' ? state.delayMs(url.pathname) : state.delayMs) : 0;
    const send = (body, status = 200) => (delay ? setTimeout(reply, delay, body, status) : reply(body, status));
    if (req.method === 'GET' && state.resetNext > 0) { state.resetNext -= 1; return req.socket.destroy(); }
    if (req.method === 'POST' && url.pathname === '/api/exec') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      state.execInFlight += 1;
      state.execMaxInFlight = Math.max(state.execMaxInFlight, state.execInFlight);
      res.on('close', () => { state.execInFlight -= 1; });
      req.on('end', () => (state.execDelayMs ? setTimeout(answer, state.execDelayMs) : answer()));
      const answer = () => {
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send({ error: 'bad json', code: 'INVALID_ARGUMENT' }, 400); }
        state.execCalls.push(body);
        const hooked = state.execHook?.(body);
        if (hooked === 'hang') return;
        if (hooked === 'reset') return req.socket.destroy();
        if (hooked?.raw !== undefined) { res.statusCode = hooked.status; return res.end(hooked.raw); }
        if (hooked) return send(hooked.body, hooked.status);
        try {
          run(state, parse(body), req, res);
        } catch (e) {
          if (!(e instanceof Answer)) throw e;
          send(e.body, e.status);
        }
      };
      return;
    }
    const hooked = req.method === 'GET' && state.getHook?.(url.pathname);
    if (hooked) return send(hooked.body, hooked.status);
    if (url.pathname === '/api/projects') return send(state.projects);
    if (url.pathname === '/api/instances') {
      if (state.instances === null) return send({}, 500);
      return send(state.instances.map(({ displayLabel, ...i }) => (state.displayLabel
        ? { ...i, displayLabel: displayLabel ?? (i.title || i.firstPrompt || `${i.sessionId.slice(0, 8)}…`) }
        : i)));
    }
    if (url.pathname === '/api/plugins') return send({ rows: state.plugins, notices: [] });
    if (url.pathname === '/api/conductors/projects') return state.conductorProjects === null ? send({}, 404) : send(state.conductorProjects);
    const loc = url.pathname.match(/^\/api\/projects\/([^/]+)\/location$/);
    if (loc) {
      const p = state.projects.find((x) => x.name === decodeURIComponent(loc[1]));
      if (!p) return send({ error: `unknown project: ${decodeURIComponent(loc[1])}`, code: 'PROJECT_UNKNOWN' }, 404);
      return send({ name: p.name, path: p.path, system: p.system ?? 'local', remoteId: p.remoteId ?? null });
    }
    const m = url.pathname.match(/^\/api\/projects\/([^/]+)\/worktrees$/);
    if (m) return send(state.worktrees[decodeURIComponent(m[1])] ?? []);
    res.statusCode = 404; res.end('{}');
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const prev = process.env.CONDUCTOR_URL;
  const prevRetry = process.env.CODE_REVIEW_CC_RETRY_MS;
  const prevStore = process.env.CODE_REVIEW_STORE;
  const prevTtl = process.env.CODE_REVIEW_LOOKUP_TTL_MS;
  if (prevRetry === undefined) process.env.CODE_REVIEW_CC_RETRY_MS = '1';
  if (prevTtl === undefined) process.env.CODE_REVIEW_LOOKUP_TTL_MS = '0';
  const ownStore = prevStore === undefined ? fs.mkdtempSync(path.join(os.tmpdir(), 'cr-fakecc-')) : null;
  if (ownStore) process.env.CODE_REVIEW_STORE = ownStore;
  process.env.CONDUCTOR_URL = `http://127.0.0.1:${server.address().port}`;
  return {
    state,
    close() {
      if (prev === undefined) delete process.env.CONDUCTOR_URL; else process.env.CONDUCTOR_URL = prev;
      if (prevRetry === undefined) delete process.env.CODE_REVIEW_CC_RETRY_MS;
      if (prevTtl === undefined) delete process.env.CODE_REVIEW_LOOKUP_TTL_MS;
      if (ownStore) {
        if (process.env.CODE_REVIEW_STORE === ownStore) delete process.env.CODE_REVIEW_STORE;
        fs.rmSync(ownStore, { recursive: true, force: true });
      }
      for (const s of sockets) s.destroy();
      server.close();
    },
  };
}
