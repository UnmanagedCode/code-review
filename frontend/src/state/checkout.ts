import * as ep from '@/lib/endpoints';
import { useFetch } from './useFetch';

export const useProjects = () => useFetch(() => ep.projects(), []);

export const useCheckout = (project: string | undefined, worktree: string | null) =>
  useFetch(project ? () => ep.checkout(project, worktree) : null, [project, worktree]);

export const useCheckoutCommits = (project: string | undefined, worktree: string | null, limit: number, enabled = true) =>
  useFetch(project && enabled ? () => ep.checkoutCommits(project, worktree, limit) : null, [project, worktree, limit, enabled]);

export const useSessions = (project: string | undefined, worktree: string | null) =>
  useFetch(project ? () => ep.sessions(project, worktree) : null, [project, worktree]);
