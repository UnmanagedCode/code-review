import * as reviews from './reviews.js';
import * as threads from './threads.js';
import { sessionCheckout, isConductorProject } from './checkouts.js';
import { Refusal, attempt } from './refusals.js';
import { reviewLink, threadLink } from './links.js';
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
      if (isConductorProject(actor.project)) throw new Refusal('INVALID_ARGUMENT', 'a conductor has no checkout of its own: name project and worktree');
      const co = await sessionCheckout(actor.sessionId);
      if (!co) throw new Refusal('CHECKOUT_UNKNOWN', `code-conductor does not know session ${actor.sessionId}`);
      ({ project, worktree } = co);
    }
    const res = await reviews.openReview({ project, worktree: worktree || null, kind: a.kind, base: a.base, sha: a.sha, author: a.author, title: a.title }, actor);
    return res.ok ? { ...res, review: { ...res.review, link: reviewLink(res.review) } } : res;
  }),

  get_review: async (a) => {
    const res = await reviews.getReview(a.review);
    return res.ok ? { text: renderRollup(res.review, res.files, res.reviewThreads), meta: { ...res.review, link: reviewLink(res.review) } } : res;
  },

  list_threads: async (a) => {
    const res = await threads.listThreads(a.review, { status: a.status, file: a.file, owner: a.owner });
    if (!res.ok) return res;
    const text = res.threads.length ? renderThreads(res.threads) : `no ${a.status ?? 'open'} threads${a.owner ? ` opened by ${a.owner === 'user' ? 'the user' : 'agents'}` : ''}`;
    const rv = { id: res.review, project: res.project, worktree: res.worktree };
    return { text, meta: { review: res.review, count: res.threads.length, counts: res.counts, threads: res.threads.map((t) => ({ id: t.id, anchor: t.anchor.kind, link: threadLink(rv, t) })) } };
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
    // `threads.annotate` checks the combination, for this surface and REST alike.
    const anchor = { kind: a.anchor, file: a.file, side: a.side, startLine: a.startLine, endLine: a.endLine, hunkId: a.hunk };
    return threads.annotate(a.review, actor, { anchor, kind: a.kind, severity: a.severity, body: a.body });
  }),

  reply: (a, caller) => attempt(async () => threads.reply(a.review, needCaller(caller), a.thread, { body: a.body, resolve: a.resolve === true, disposition: a.disposition })),

  refresh_review: (a, caller) => attempt(async () => reviews.refreshReview(a.review, needCaller(caller))),
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
