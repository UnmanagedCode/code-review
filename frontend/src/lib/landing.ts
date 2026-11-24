import { REVIEW_SCOPED, type Route } from './route';
import type { BridgeSession } from './bridge';
import type { InboxItem } from './types';

export interface LandingOptions {
  /** The session's project is one the project list names, so its checkout can be shown. */
  knownProject: boolean;
  /** Where the inbox opens when the session names no usable checkout: the remembered one, or none. */
  fallback: Route;
  /** The tab to show when the session has no single review: the inbox on a first landing, the current tab after a later session change. */
  view: Route['view'];
}

/**
 * Where a cc session's page opens: its one open review (as recipient or author), else the inbox on its checkout.
 * `open` is every open review (`GET api/inbox`).
 */
export function sessionLanding(session: BridgeSession, open: InboxItem[], { knownProject, fallback, view }: LandingOptions): Route {
  const mine = open.filter((r) => r.recipient === session.sessionId || r.author === session.sessionId);
  if (mine.length === 1) return { project: mine[0].project, worktree: mine[0].worktree ?? undefined, review: mine[0].id, ...REVIEW_SCOPED };
  if (knownProject) return { project: session.project, worktree: session.worktree ?? undefined, view };
  return { ...fallback, view };
}
