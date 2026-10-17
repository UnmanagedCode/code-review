import express from 'express';
import * as cc from './cc.js';
import * as store from './store.js';
import * as reviews from './reviews.js';
import * as rounds from './rounds.js';
import * as threads from './threads.js';
import * as submissions from './submissions.js';
import { sessions, checkoutInfo, checkoutCommits } from './checkouts.js';
import { handle as handleMcp } from './mcp.js';
import { HTTP_STATUS, attempt, refuse } from './refusals.js';
import { errorLine, oneLine, stackFrames } from './text.js';

const HUMAN = { kind: 'human' };
export const HEARTBEAT_MS = 25000;

function send(res, result) {
  if (result?.ok === false) return res.status(HTTP_STATUS[result.code] ?? 500).json(result);
  return res.json(result);
}

// Wraps a handler: a returned/thrown refusal maps to its HTTP status, anything else is a 500.
const route = (fn) => async (req, res) => {
  try {
    send(res, await attempt(() => fn(req)));
  } catch (e) {
    // One cleaned header line, then only the stack's frame lines: message text never reaches the log raw.
    console.error([`code-review: ${oneLine(req.method)} ${oneLine(req.originalUrl)} failed: ${errorLine(e)}`, ...stackFrames(e)].join('\n'));
    res.status(500).json(refuse('INTERNAL', e.message));
  }
};

const checkoutQuery = (q) => {
  if (!q.project) return refuse('INVALID_ARGUMENT', 'project is required');
  return { project: q.project, worktree: q.worktree || null };
};
const withCheckout = (fn) => async (req) => {
  const co = checkoutQuery(req.query);
  return co.ok === false ? co : fn(co, req);
};

/** Express router for the REST API, SSE stream and MCP endpoint; mounted at /api. */
export function apiRouter() {
  const r = express.Router();
  // A cross-site HTML form can only send simple content types, so requiring JSON keeps it from triggering mutations.
  // (`req.is` answers null for a body-less request, so the header is checked directly.)
  r.use((req, res, next) => {
    const jsonType = /^application\/json\s*(;|$)/i.test(req.headers['content-type'] ?? '');
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || jsonType) return next();
    return res.status(415).json(refuse('UNSUPPORTED_MEDIA_TYPE', 'mutating requests must send Content-Type: application/json'));
  });
  r.use(express.json());

  r.get('/projects', route(async () => ({
    ok: true, projects: (await cc.projects()).filter((p) => !p.system || p.system === 'local').map((p) => ({ name: p.name })),
  })));
  r.get('/checkout', route(withCheckout(async (co) => ({ ok: true, ...(await checkoutInfo(co)) }))));
  r.get('/checkout/commits', route(withCheckout(async (co, req) => ({ ok: true, commits: await checkoutCommits({ ...co, limit: req.query.limit }) }))));
  r.get('/sessions', route(withCheckout(async (co) => ({ ok: true, sessions: await sessions(co) }))));

  r.get('/reviews', route((req) => reviews.listReviews({
    project: req.query.project,
    worktree: 'worktree' in req.query ? req.query.worktree || null : undefined,
    status: req.query.status,
  })));
  r.post('/reviews', route((req) => reviews.openReview(req.body ?? {}, HUMAN)));
  r.get('/reviews/:id', route((req) => reviews.getReview(req.params.id)));
  r.patch('/reviews/:id', route((req) => reviews.patchReview(req.params.id, req.body ?? {})));
  r.delete('/reviews/:id', route((req) => reviews.deleteReview(req.params.id)));
  r.get('/reviews/:id/diff', route((req) => reviews.diff(req.params.id, { file: req.query.file, commit: req.query.commit, round: req.query.round })));
  r.get('/reviews/:id/commits', route((req) => reviews.commits(req.params.id)));
  r.get('/reviews/:id/rounds/:n', route((req) => rounds.roundView(req.params.id, req.params.n)));
  r.get('/reviews/:id/file', route((req) => reviews.fileLines(req.params.id, req.query)));

  r.put('/reviews/:id/hunks/:hunkId/verdict', route((req) => reviews.setVerdict(req.params.id, req.params.hunkId, req.body?.verdict)));
  r.post('/reviews/:id/accept-file', route((req) => reviews.acceptFile(req.params.id, req.body?.file, req.body?.hunkIds)));
  r.post('/reviews/:id/threads', route((req) => threads.annotate(req.params.id, HUMAN, req.body ?? {})));
  r.post('/reviews/:id/threads/:tid/messages', route((req) => threads.reply(req.params.id, HUMAN, req.params.tid, req.body ?? {})));
  r.patch('/reviews/:id/threads/:tid', route((req) => threads.setThreadStatus(req.params.id, req.params.tid, req.body ?? {})));
  r.post('/reviews/:id/refresh', route((req) => reviews.refreshReview(req.params.id)));
  r.post('/reviews/:id/submissions', route((req) => submissions.composeSubmission(req.params.id)));
  r.post('/reviews/:id/submissions/:sid/result', route((req) => submissions.recordResult(req.params.id, req.params.sid, req.body ?? {})));
  r.post('/reviews/:id/read', route((req) => threads.markRead(req.params.id, req.body ?? {})));

  r.get('/events', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    const onChange = (change) => res.write(`event: review\ndata: ${JSON.stringify(change)}\n\n`);
    store.changes.on('change', onChange);
    const beat = setInterval(() => res.write(': heartbeat\n\n'), HEARTBEAT_MS);
    beat.unref();
    req.on('close', () => { store.changes.off('change', onChange); clearInterval(beat); });
    res.write(': connected\n\n');
  });

  r.post('/mcp', async (req, res) => {
    const out = await handleMcp(req.body);
    res.status(out.status).json(out.body);
  });

  // Malformed JSON bodies and other router errors answer JSON, like every other /api response.
  r.use((err, _req, res, _next) => {
    const status = err.status && err.status < 500 ? err.status : 500;
    res.status(status).json(refuse(status === 400 ? 'INVALID_ARGUMENT' : 'INTERNAL', err.message));
  });
  return r;
}
