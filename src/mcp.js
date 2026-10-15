import * as reviews from './reviews.js';
import * as threads from './threads.js';
import { sessionCheckout } from './checkouts.js';
import { Refusal, attempt } from './refusals.js';
import { renderRollup, renderThreads, renderHunk } from './render.js';

// Every handler returns a service result: a refusal, `{ok:true, ...}`, or `{text, meta}` for prose tools.
const needCaller = (caller) => {
  if (!caller?.sessionId) throw new Refusal('CALLER_UNKNOWN', 'this tool needs the calling session; call it from a Claude Code session');
  return { kind: 'agent', sessionId: caller.sessionId, project: caller.project };
};

const handlers = {
  open_review: (a, caller) => attempt(async () => {
    const actor = needCaller(caller);
    let { project, worktree } = a;
    if (!project) {
      if (worktree) throw new Refusal('INVALID_ARGUMENT', 'worktree needs project');
      const co = await sessionCheckout(a.recipient ?? actor.sessionId);
      if (!co) throw new Refusal('CHECKOUT_UNKNOWN', `code-conductor does not know session ${a.recipient ?? actor.sessionId}`);
      ({ project, worktree } = co);
    }
    return reviews.openReview({ project, worktree: worktree ?? null, kind: a.kind, base: a.base, sha: a.sha, recipient: a.recipient, title: a.title }, actor);
  }),

  get_review: async (a) => {
    const res = await reviews.getReview(a.review);
    return res.ok ? { text: renderRollup(res.review, res.files), meta: res.review } : res;
  },

  list_threads: async (a) => {
    const res = await threads.listThreads(a.review, { status: a.status, file: a.file });
    if (!res.ok) return res;
    const text = res.threads.length ? renderThreads(res.threads) : `no ${a.status ?? 'open'} threads`;
    return { text, meta: { review: res.review, count: res.threads.length, counts: res.counts } };
  },

  get_hunk: async (a) => {
    const res = await reviews.getHunks(a.review, { hunk: a.hunk, file: a.file, line: a.line });
    if (!res.ok) return res;
    return {
      text: res.hunks.map((h) => renderHunk(res.file, h)).join('\n\n'),
      meta: { file: res.file, hunks: res.hunks.map((h) => ({ id: h.hunk.id, verdict: h.verdict, threadIds: h.threadIds })) },
    };
  },

  annotate: (a, caller) => attempt(async () => {
    const actor = needCaller(caller);
    let anchor;
    if (a.hunk) anchor = { hunkId: a.hunk };
    else if (a.file && a.startLine) anchor = { file: a.file, side: a.side ?? 'new', startLine: a.startLine, endLine: a.endLine ?? a.startLine };
    else throw new Refusal('INVALID_ARGUMENT', 'give file and startLine, or hunk');
    return threads.annotate(a.review, actor, { anchor, kind: a.kind, severity: a.severity, body: a.body });
  }),

  reply: (a, caller) => attempt(async () => threads.reply(a.review, needCaller(caller), a.thread, { body: a.body, resolve: a.resolve === true })),

  refresh_review: (a, caller) => attempt(async () => {
    needCaller(caller);
    return reviews.refreshReview(a.review);
  }),
};

/** Tool names this module implements (test seam: must equal the manifest's). */
export const _toolNames = () => Object.keys(handlers);

/** cc MCP envelope: {tool, arguments, caller:{sessionId, project}} -> {status, body}. */
export async function handle(body) {
  const { tool, arguments: args, caller } = body || {};
  if (typeof tool !== 'string' || tool.length === 0) return { status: 400, body: { error: 'tool is required and must be a non-empty string' } };
  const fn = handlers[tool];
  if (!fn) return { status: 200, body: { error: `unknown tool: ${tool}` } };
  try {
    const out = await fn(args ?? {}, caller);
    return { status: 200, body: 'text' in out ? { text: out.text, meta: out.meta } : { result: out } };
  } catch (e) {
    return { status: 200, body: { error: e.message } };
  }
}
