import * as ep from '@/lib/endpoints';
import { useResource } from './resource';
import { useFetch } from './useFetch';

/** Cache key: the parts joined by NUL, so names cannot collide; null and undefined read as ''. */
export const resourceKey = (...parts: (string | null | undefined)[]): string => parts.map((p) => p ?? '').join('\0');

export const useProjects = () => useResource('projects', { fetch: () => ep.projects() });

export const useCheckout = (project: string | undefined, worktree: string | null) =>
  useResource(project ? resourceKey('checkout', project, worktree) : null, { fetch: () => ep.checkout(project!, worktree) });

export const useCheckoutCommits = (project: string | undefined, worktree: string | null, limit: number, enabled = true) =>
  useFetch(project && enabled ? () => ep.checkoutCommits(project, worktree, limit) : null, [project, worktree, limit, enabled]);

export const useSessionPlaces = (sessionId: string | undefined) =>
  useResource(sessionId ? resourceKey('places', sessionId) : null, { fetch: () => ep.sessionPlaces(sessionId!) });

export const useSessions = (project: string | undefined, worktree: string | null) =>
  useResource(project ? resourceKey('sessions', project, worktree) : null, { fetch: () => ep.sessions(project!, worktree) });
