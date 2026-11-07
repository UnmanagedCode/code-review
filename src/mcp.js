import * as reviews from './reviews.js';
import * as threads from './threads.js';
import * as groups from './groups.js';
import { sessionCheckout, isConductorProject } from './checkouts.js';
import { Refusal, attempt, isRefusal } from './refusals.js';
import { views } from './mcpViews.js';

// Every handler returns a service result, a refusal or `{ok:true, ...}`; `views` (mcpViews.js) turns a success into json or text.
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
    return reviews.openReview({ project, worktree: worktree || null, kind: a.kind, base: a.base, sha: a.sha, author: a.author, title: a.title }, actor);
  }),

  get_review: (a) => reviews.getReview(a.review),

  list_threads: (a) => threads.listThreads(a.review, { status: a.status, file: a.file, owner: a.owner }),

  get_hunk: (a) => reviews.getHunks(a.review, { hunk: a.hunk, file: a.file, line: a.line }),

  annotate: (a, caller) => attempt(async () => {
    const actor = needCaller(caller);
    // `threads.annotate` checks the combination, for this surface and REST alike.
    const anchor = { kind: a.anchor, file: a.file, side: a.side, startLine: a.startLine, endLine: a.endLine, hunkId: a.hunk, groupId: a.group };
    return threads.annotate(a.review, actor, { anchor, kind: a.kind, severity: a.severity, body: a.body });
  }),

  reply: (a, caller) => attempt(async () => threads.reply(a.review, needCaller(caller), a.thread, { body: a.body, resolve: a.resolve === true, disposition: a.disposition })),

  propose_groups: (a, caller) => attempt(() => groups.proposeGroups(a.review, needCaller(caller), a.groups)),

  refresh_review: (a, caller) => attempt(async () => reviews.refreshReview(a.review, needCaller(caller))),
};

/** Tool names this module implements (test seam: must equal the manifest's). */
export const _toolNames = () => Object.keys(handlers);

const FORMATS = ['json', 'text'];

/** A refusal as the wire shows it: `{error, code}`, plus `details` (a plain object) when the refusal carries fields beyond `ok`/`code`/`reason`. */
export function refusalBody({ ok, code, reason, ...extras }) {
  return { error: reason, code, ...(Object.keys(extras).length ? { details: extras } : {}) };
}

/**
 * cc MCP envelope {tool, arguments, caller:{sessionId, project}, format} -> {status, body}.
 * `format` json answers `{structured}`, text (or absent: a host that predates `format`) `{text}`; a refusal is
 * `{error, code[, details]}` in both and an unexpected failure `{error}`. Any other `format`, or no `tool`, is 400 and runs nothing.
 */
export async function handle(body) {
  const { tool, arguments: args, caller, format = 'text' } = body || {};
  if (typeof tool !== 'string' || tool.length === 0) return { status: 400, body: { error: 'tool is required and must be a non-empty string' } };
  if (!FORMATS.includes(format ?? 'text')) return { status: 400, body: { error: 'format must be "json" or "text"' } };
  const fn = handlers[tool];
  if (!fn) return { status: 200, body: { error: `unknown tool: ${tool}`, code: 'TOOL_UNKNOWN' } };
  try {
    const res = await fn(args ?? {}, caller);
    if (isRefusal(res)) return { status: 200, body: refusalBody(res) };
    return { status: 200, body: format === 'json' ? { structured: views[tool].json(res, args ?? {}) } : { text: views[tool].text(res, args ?? {}) } };
  } catch (e) {
    return { status: 200, body: { error: e.message } };
  }
}
