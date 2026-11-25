import { guideAvailable } from '@/lib/guide';
import { useRoute, type Route } from '@/lib/route';
import type { GuideView, ReviewSummary } from '@/lib/types';
import { useReviewCtx } from '@/state/reviewContext';

export type PaneTab = 'files' | 'guided' | 'threads' | 'history';

/**
 * The pane tab a route selects. Absent `view` is the review's default tab: Guided when `guidedDefault` (pinned by
 * `ReviewView`), else Files. `view=guided` where Guided isn't available (uncommitted, past views, commit filter, no
 * guide) shows Files, derived without rewriting the URL; so does `view=history` outside a range review.
 */
export function paneTab(route: Route, ctx: { review: ReviewSummary; guide: GuideView | null; pastView: boolean; commit: string | undefined; guidedDefault?: boolean }): PaneTab {
  const wantsGuided = route.view === 'guided' || (route.view === undefined && !!ctx.guidedDefault);
  if (wantsGuided && guideAvailable(ctx)) return 'guided';
  return route.view === 'threads' ? 'threads' : route.view === 'history' && ctx.review.kind === 'range' ? 'history' : 'files';
}

/** The pane tab showing now. Every consumer reads it here, never from `route.view`, which is absent on the default tab. */
export function usePaneTab(): PaneTab {
  const route = useRoute();
  return paneTab(route, useReviewCtx());
}
