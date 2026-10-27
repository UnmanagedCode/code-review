import manifest from '../conductor.plugin.json' with { type: 'json' };

// Mirrors `parseRoute`'s grammar and `at()` in ThreadCard.tsx; tests/links.test.js round-trips through the real `parseRoute`.
const PLUGIN_ID = manifest.id;
// The order of `KEYS` in frontend/src/lib/route.ts.
const ORDER = ['project', 'worktree', 'review', 'file', 'side', 'lines', 'thread', 'commit', 'round', 'compare', 'view'];

function link(route) {
  const p = new URLSearchParams();
  for (const k of ORDER) if (route[k]) p.set(k, route[k]);
  return `#plugin/${encodeURIComponent(PLUGIN_ID)}/?${p}`;
}

const reviewRoute = ({ id, project, worktree }) => ({ project, worktree, review: id });

/** Origin-relative link that opens a review in its checkout. */
export const reviewLink = (review) => link(reviewRoute(review));

/**
 * Link to the route that shows `thread` in place: live threads at their file, outdated ones in the round they last sat in,
 * review threads in the Threads pane.
 */
export function threadLink(review, { id, status, anchor }) {
  if (anchor.kind === 'review') return link({ ...reviewRoute(review), view: 'threads', thread: id });
  const base = { ...reviewRoute(review), file: anchor.file, thread: id };
  if (anchor.kind === 'file') return link(status === 'outdated' ? { ...base, round: String(anchor.round) } : base);
  if (status !== 'outdated') return link({ ...base, side: anchor.side });
  const lines = anchor.startLine === anchor.endLine ? String(anchor.startLine) : `${anchor.startLine}-${anchor.endLine}`;
  const past = anchor.side === 'old' ? { round: String(anchor.round) } : { compare: `${anchor.round}..${anchor.round + 1}` };
  return link({ ...base, side: 'old', lines, ...past });
}
