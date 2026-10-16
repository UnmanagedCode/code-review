import * as ep from '@/lib/endpoints';
import { useSseReload } from './live';
import { useFetch } from './useFetch';

/** `worktree`: undefined = every checkout of the project, '' = the main checkout. Any review event refetches the list. */
export function useReviewList(project: string | undefined, worktree: string | undefined, status: string) {
  const list = useFetch(project ? () => ep.reviews(project, worktree, status) : null, [project, worktree, status]);
  useSseReload(list.reload, () => true, !!project);
  return list;
}
