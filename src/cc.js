import { Refusal } from './refusals.js';

const DEFAULT_TIMEOUT_MS = 3000;

async function get(route) {
  const base = process.env.CONDUCTOR_URL;
  if (!base) throw new Refusal('CONDUCTOR_UNAVAILABLE', 'CONDUCTOR_URL is not set: run inside code-conductor');
  const timeout = Number(process.env.CODE_REVIEW_CC_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  try {
    const res = await fetch(base + route, { signal: AbortSignal.timeout(timeout) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    throw new Refusal('CONDUCTOR_UNAVAILABLE', `code-conductor ${route}: ${e.message}`);
  }
}

/** Rows {name, path, system?} */
export const projects = () => get('/api/projects');
/** Rows {worktreeName, worktreePath, branch, baseBranch, baseSha, baseWorktree?, parentPath} */
export const worktrees = (project) => get(`/api/projects/${encodeURIComponent(project)}/worktrees`);
/** Rows {sessionId, project, status, cwd, title, conducted, worktree} */
export const instances = () => get('/api/instances');
