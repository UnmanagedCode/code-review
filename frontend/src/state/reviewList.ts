import * as ep from '@/lib/endpoints';
import { resourceKey } from './checkout';
import { useResource } from './resource';

/**
 * `worktree`: undefined = every checkout of the project, '' = the main checkout. Any review event stales the list, except
 * the echo of a revision it already shows.
 */
export function useReviewList(project: string | undefined, worktree: string | undefined, status: string) {
  return useResource(project ? resourceKey('reviews', project, worktree === undefined ? '*' : `=${worktree}`, status) : null, {
    fetch: () => ep.reviews(project!, worktree, status),
    matches: (e, data) => {
      const row = data?.reviews.find((r) => r.id === e.id);
      return !(row && e.rev !== undefined && e.rev <= row.rev);
    },
  });
}
