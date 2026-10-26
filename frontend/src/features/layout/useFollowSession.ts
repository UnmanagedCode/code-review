import { useEffect, useRef } from 'react';
import { getBridge, useBridgeSession } from '@/lib/bridge';
import { navigateTo, type Route } from '@/lib/route';
import * as storage from '@/lib/storage';
import { useProjects, useSessions } from '@/state/checkout';

function remembered(): { project: string; worktree?: string } | null {
  try {
    const v = JSON.parse(storage.getItem('lastCheckout') ?? 'null') as { project?: string; worktree?: string | null } | null;
    return v?.project ? { project: v.project, worktree: v.worktree ?? undefined } : null;
  } catch {
    return null;
  }
}

/**
 * Picks the checkout: the route if it names one, else cc's active session, else the last one used.
 * With a bridge, later session changes to a listed project switch the checkout. Inert without a bridge.
 * A session change while a review is open is dropped, never deferred: the route is not in the effect's deps, so leaving the
 * review does not replay it. Following keeps `view=inbox` and never touches `review`.
 */
export function useFollowSession(route: Route) {
  const projects = useProjects();
  const session = useBridgeSession();
  const names = projects.data?.projects.map((p) => p.name);
  const known = !!session && !!names?.includes(session.project);
  const routeProject = route.project;
  const consumed = useRef(false);
  const sessions = useSessions(routeProject, route.worktree ?? null);

  useEffect(() => {
    if (!names) return;
    const bridge = getBridge();
    if (bridge && session === undefined) return; // cc has not told us yet
    const first = !consumed.current;
    consumed.current = true;
    if (route.review) return; // an open review is never closed by following
    if (first && routeProject) return; // a route-named checkout wins on load
    const keep = route.view === 'inbox' ? { view: 'inbox' as const } : {};
    if (known && session) {
      if (session.project === routeProject && (session.worktree ?? undefined) === route.worktree) return;
      navigateTo({ project: session.project, worktree: session.worktree ?? undefined, ...keep }, { replace: true });
    } else if (first && !routeProject) {
      const last = remembered();
      if (last && names.includes(last.project)) navigateTo({ ...last, ...keep }, { replace: true });
    }
  }, [names?.join(), session?.sessionId, session?.project, session?.worktree, known]);

  const followed = known ? sessions.data?.sessions.find((s) => s.sessionId === session!.sessionId) : undefined;
  return {
    followingTitle: known && session!.project === routeProject && (session!.worktree ?? undefined) === route.worktree ? (followed?.label || session!.sessionId.slice(0, 8)) : undefined,
    unfollowable: !!session && !!names && !known,
  };
}
