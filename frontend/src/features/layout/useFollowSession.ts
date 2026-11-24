import { useEffect, useRef, useState } from 'react';
import { getBridge, useBridgeSession } from '@/lib/bridge';
import { sessionLanding } from '@/lib/landing';
import { navigateTo, type Route } from '@/lib/route';
import * as storage from '@/lib/storage';
import type { InboxItem } from '@/lib/types';
import { useProjects, useSessions } from '@/state/checkout';
import { INBOX_KEY, inboxSpec } from '@/state/inbox';
import { ensure } from '@/state/resource';

/** A bridge session whose project the cached project list lacks triggers a refetch of a list older than this. */
export const PROJECTS_RECHECK_MS = 10_000;

function remembered(): { project: string; worktree?: string } | null {
  try {
    const v = JSON.parse(storage.getItem('lastCheckout') ?? 'null') as { project?: string; worktree?: string | null } | null;
    return v?.project ? { project: v.project, worktree: v.worktree ?? undefined } : null;
  } catch {
    return null;
  }
}

/**
 * Picks where the page opens, once the project list is known (and, with a bridge, cc has named its session):
 * - the route names a checkout (or cc's row menu did): that wins, nothing else is touched;
 * - embedded with a session: the session's one open review (as recipient or author), else the inbox on its checkout;
 * - standalone, or no session: the inbox, on the last checkout used.
 * A later session change, with no review open, applies the same rule but keeps the current tab when the session has no single
 * review. One with a review open is dropped, never deferred: it is not replayed when the review closes. `landing` is
 * `pending` until the first rule has been applied, so the list pane can show the inbox instead of an empty picker meanwhile.
 * `menuOnLoad`: this load came from cc's row menu, which picks the checkout, so neither the session nor the remembered checkout may race it.
 */
export function useFollowSession(route: Route, menuOnLoad = false) {
  const projects = useProjects();
  const session = useBridgeSession();
  const names = projects.data?.projects.map((p) => p.name);
  const known = !!session && !!names?.includes(session.project);
  const routeProject = route.project;
  /** The session (by id and checkout) the last rule was applied for; null before the first. */
  const handled = useRef<string | null>(null);
  const [landing, setLanding] = useState<'pending' | 'done'>('pending');
  const sessions = useSessions(routeProject, route.worktree ?? null);
  const sessionKey = session ? JSON.stringify([session.sessionId, session.project, session.worktree]) : '';

  useEffect(() => {
    if (!names) return;
    const bridge = getBridge();
    if (bridge && session === undefined) return; // cc has not told us yet
    const first = handled.current === null;
    if (!first && handled.current === sessionKey) return; // not a session change: the project list alone never re-lands
    const done = () => { handled.current = sessionKey; setLanding('done'); };
    if (route.review) return done(); // an open review is never closed by following
    if (first && (routeProject || menuOnLoad)) return done(); // a route-named or menu-named checkout wins on load
    const view = route.view === 'inbox' ? 'inbox' as const : undefined;
    const last = remembered();
    const fallback: Route = last && names.includes(last.project) ? last : {};
    if (!session) {
      if (first) navigateTo({ ...fallback, view: 'inbox' }, { replace: true });
      return done();
    }
    // The inbox is awaited through its shared cache entry, so the visible Inbox reuses this request.
    const at = location.search;
    let live = true;
    const apply = (open: InboxItem[] | null) => {
      if (!live) return; // superseded by a newer session or a remount: that run decides
      if (location.search !== at) return done(); // the user (or cc) navigated meanwhile: their move stands
      const land = sessionLanding(session, open ?? [], { knownProject: known, fallback, view: first ? 'inbox' : view });
      // A later change to a project the list lacks, with no review to open, leaves the page where it is.
      if (first || land.review || known) navigateTo(land, { replace: true });
      done();
    };
    ensure(INBOX_KEY, inboxSpec).then((r) => apply(r.reviews), () => apply(null));
    return () => { live = false; };
  }, [names?.join(), sessionKey, known]);

  // A project created since the cached list was fetched becomes followable.
  const missing = !!session && !!names && !known;
  useEffect(() => {
    if (missing && Date.now() - projects.loadedAt > PROJECTS_RECHECK_MS) projects.reload();
  }, [missing, session?.project, projects.loadedAt]);

  const followed = known ? sessions.data?.sessions.find((s) => s.sessionId === session!.sessionId) : undefined;
  return {
    landing,
    followingTitle: known && session!.project === routeProject && (session!.worktree ?? undefined) === route.worktree ? (followed?.label || session!.sessionId.slice(0, 8)) : undefined,
    unfollowable: !!session && !!names && !known,
  };
}
