import * as ep from './endpoints';
import { getBridge } from './bridge';
import type { Commit, ReviewSummary, Round } from './types';
import { useFetch } from '@/state/useFetch';

/** What code-git opens: its tab for the checkout, optionally a commit selected, optionally a file's history at that commit. */
export interface CodeGitTarget { project: string; worktree: string | null; commit?: string; path?: string }

/** code-git's frame subpath (docs/protocol.md → "Open in code-git"), keys in contract order. */
export function codeGitSubpath({ project, worktree, commit, path }: CodeGitTarget): string {
  const p = new URLSearchParams({ project });
  if (worktree) p.set('worktree', worktree);
  if (commit) {
    p.set('commit', commit);
    if (path) p.set('path', path);
  }
  return `?${p}`;
}

/** cc's own path and query, read from the top frame; null standalone or when the top frame cannot be read. */
function topBase(): string | null {
  if (!getBridge() || window.top === window || !window.top) return null;
  try {
    const { pathname, search } = window.top.location;
    return pathname + search;
  } catch {
    return null;
  }
}

/**
 * The top-frame href that opens code-git's view inside cc: cc's current path and query plus a `#plugin/<id>/…` hash,
 * so following it is a fragment navigation (no reload) that cc's hash router picks up.
 */
export function codeGitHref(id: string, target: CodeGitTarget): string | null {
  const base = topBase();
  return base === null ? null : `${base}#plugin/${encodeURIComponent(id)}/${codeGitSubpath(target)}`;
}

let integrations: ReturnType<typeof ep.integrations> | null = null;
const loadIntegrations = () => (integrations ??= ep.integrations().catch((e: unknown) => { integrations = null; throw e; }));
/** Test seam: forget the memoised `api/integrations` answer. */
export const resetCodeGit = (): void => { integrations = null; };

/** code-git's plugin id when cc offers it, else null (also standalone, while loading and on error). Fetched once per page, and only where a link could be followed. */
export function useCodeGit(): string | null {
  const r = useFetch(topBase() !== null ? loadIntegrations : null, []);
  return r.data?.codeGit?.id ?? null;
}

/** The href for `target`, or null when no link may be shown. */
export function useCodeGitHref(target: CodeGitTarget | null): string | null {
  const id = useCodeGit();
  return id && target ? codeGitHref(id, target) : null;
}

const FULL_SHA = /^[0-9a-f]{40}$/;

/**
 * The commit the diff's new side shows: the filtered commit (a prefix is looked up in `commits`), the viewed round's head,
 * the comparison's later round's head, else the review's head. Null when it cannot be told.
 */
export function shownHeadSha(
  ctx: { review: Pick<ReviewSummary, 'headSha'>; rounds: Round[]; commit: string | undefined; round: number | undefined; compare: { to: number } | undefined },
  commits?: Commit[],
): string | null {
  const { commit } = ctx;
  if (commit) return FULL_SHA.test(commit) ? commit : commits?.find((c) => c.sha.startsWith(commit))?.sha ?? null;
  const headOf = (n: number) => ctx.rounds.find((r) => r.n === n)?.headSha ?? null;
  if (ctx.round !== undefined) return headOf(ctx.round);
  if (ctx.compare) return headOf(ctx.compare.to);
  return ctx.review.headSha;
}
