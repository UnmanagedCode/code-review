import { ccFetch, unavailable } from './ccFetch.js';

/** The GET budget per attempt. */
export const DEFAULT_TIMEOUT_MS = 15_000;
export const ccTimeoutMs = () => Number(process.env.CODE_REVIEW_CC_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;

// One GET with the shared budget and retry; `fail(cause)` logs and builds the CONDUCTOR_UNAVAILABLE for it.
async function request(route) {
  const { res, text, attempts, started } = await ccFetch(route, {}, { timeoutMs: ccTimeoutMs(), retry: 'transient' });
  const fail = (cause) => unavailable({ route: `GET ${route}`, started, attempts, cause, reason: `code-conductor ${route}: ${cause}` });
  let body;
  try { body = JSON.parse(text); } catch { /* reported below */ }
  return { res, body, fail };
}

async function get(route) {
  const { res, body, fail } = await request(route);
  if (!res.ok) throw fail(`HTTP ${res.status}`);
  if (body === undefined) throw fail('non-JSON body');
  return body;
}

/** Rows {name, path, system?, remoteId?} */
export const projects = () => get('/api/projects');
/**
 * One project's placement {name, system, remoteId, path} (cc reads it from the project's config, running nothing), or
 * null when cc does not know the project. Any other answer, a 404 without that code included, is CONDUCTOR_UNAVAILABLE.
 */
export async function location(name) {
  const { res, body, fail } = await request(`/api/projects/${encodeURIComponent(name)}/location`);
  if (res.status === 404 && body?.code === 'PROJECT_UNKNOWN') return null;
  if (!res.ok) throw fail(`HTTP ${res.status}`);
  if (body === undefined) throw fail('non-JSON body');
  return body;
}
/** Rows {worktreeName, worktreePath, branch, baseBranch, baseSha, baseWorktree?, parentPath} */
export const worktrees = (project) => get(`/api/projects/${encodeURIComponent(project)}/worktrees`);
/** Rows {sessionId, project, status, cwd, title, displayLabel?, conducted, worktree, ownerSessionId?} */
export const instances = () => get('/api/instances');
/** {[rootSessionId]: [{project, lastSpawnAt (ISO string), worktrees?: string[] | null}]}, newest spawn first: where each session's workers have ever been spawned. */
export const conductorProjects = () => get('/api/conductors/projects');
/** {rows: [{id, enabled, hasFrontend, …}], notices}: every plugin cc knows. */
export const plugins = () => get('/api/plugins');
