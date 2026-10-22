import { Refusal } from './refusals.js';

const DEFAULT_TIMEOUT_MS = 3000;

/** cc's base URL, or CONDUCTOR_UNAVAILABLE outside code-conductor. */
export function conductorUrl() {
  const base = process.env.CONDUCTOR_URL;
  if (!base) throw new Refusal('CONDUCTOR_UNAVAILABLE', 'CONDUCTOR_URL is not set: run inside code-conductor');
  return base;
}

async function get(route) {
  const base = conductorUrl();
  const timeout = Number(process.env.CODE_REVIEW_CC_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  try {
    const res = await fetch(base + route, { signal: AbortSignal.timeout(timeout) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    throw new Refusal('CONDUCTOR_UNAVAILABLE', `code-conductor ${route}: ${e.message}`);
  }
}

/** Rows {name, path, system?, remoteId?} */
export const projects = () => get('/api/projects');
/** Rows {worktreeName, worktreePath, branch, baseBranch, baseSha, baseWorktree?, parentPath} */
export const worktrees = (project) => get(`/api/projects/${encodeURIComponent(project)}/worktrees`);
/** Rows {sessionId, project, status, cwd, title, displayLabel?, conducted, worktree, ownerSessionId?} */
export const instances = () => get('/api/instances');
/** {[rootSessionId]: [{project, lastSpawnAt (ISO string), worktrees?: string[] | null}]}, newest spawn first: where each session's workers have ever been spawned. */
export const conductorProjects = () => get('/api/conductors/projects');
