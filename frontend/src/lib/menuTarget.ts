import { errorText } from './refusals';
import type { MenuTarget, Route } from './route';
import type { InboxItem } from './types';

const CANT = "Can't show reviews";

/** Toast text for a row-menu target that cannot be shown: no project, an unknown name, or a failed request. */
export function menuFailure(t: MenuTarget, e?: unknown): string {
  if (t.project === null) return `${CANT}: code-conductor named no project.`;
  const code = e && typeof e === 'object' && 'code' in e ? (e as { code?: string }).code : undefined;
  if (code === 'PROJECT_UNKNOWN') return `${CANT}: code-conductor lists no project “${t.project}”.`;
  if (code === 'CHECKOUT_UNKNOWN') return `${CANT}: project “${t.project}” has no worktree “${t.worktree}”.`;
  return `${CANT}: ${errorText(e)}`;
}

/**
 * Where a validated row-menu target lands: the checkout's one open review, else its list. Built from the lookup's
 * strings, never the query's; `open` is every open review (`GET api/inbox`).
 */
export function menuLanding(checkout: { project: string; worktree: string | null }, open: InboxItem[]): Route {
  const { project, worktree } = checkout;
  const mine = open.filter((r) => r.project === project && r.worktree === worktree);
  const at = { project, worktree: worktree ?? undefined };
  return mine.length === 1 ? { ...at, review: mine[0].id } : at;
}
