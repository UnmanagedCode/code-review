import { ccFetch, unavailable } from './ccFetch.js';

/** The GET budget per attempt. */
export const DEFAULT_TIMEOUT_MS = 15_000;
export const ccTimeoutMs = () => Number(process.env.CODE_REVIEW_CC_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;

async function get(route) {
  const { res, text, attempts, started } = await ccFetch(route, {}, { timeoutMs: ccTimeoutMs(), retry: 'transient' });
  const fail = (cause) => unavailable({ route: `GET ${route}`, started, attempts, cause, reason: `code-conductor ${route}: ${cause}` });
  if (!res.ok) throw fail(`HTTP ${res.status}`);
  try {
    return JSON.parse(text);
  } catch {
    throw fail('non-JSON body');
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
/** {rows: [{id, enabled, hasFrontend, …}], notices}: every plugin cc knows. */
export const plugins = () => get('/api/plugins');
