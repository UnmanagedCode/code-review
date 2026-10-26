import * as store from './store.js';
import * as cc from './cc.js';
import { attempt } from './refusals.js';
import { inboxItem } from './rollup.js';

/**
 * `checkoutGone` per review, from cc's lists only: one projects lookup and one worktrees lookup per project that has a worktree review,
 * all concurrent. A lookup that fails (already logged by `ccFetch`) leaves its rows unknown (null), unless another lookup already says gone.
 */
async function goneMarks(reviews) {
  const wtProjects = [...new Set(reviews.filter((r) => r.worktree !== null).map((r) => r.project))];
  const [projects, ...wts] = await Promise.allSettled([cc.projects(), ...wtProjects.map((p) => cc.worktrees(p))]);
  const worktrees = new Map(wtProjects.map((p, i) => [p, wts[i]]));
  const listed = (settled, has) => (settled.status === 'fulfilled' ? settled.value.some(has) : null);
  return reviews.map((r) => {
    const known = [listed(projects, (p) => p.name === r.project)];
    if (r.worktree !== null) known.push(listed(worktrees.get(r.project), (w) => w.worktreeName === r.worktree));
    if (known.includes(false)) return true;
    return known.includes(null) ? null : false;
  });
}

/** Every open review of every checkout, latest activity first. Store-only plus cc's lists: no git, no System is asked. */
export const listInbox = () => attempt(async () => {
  const open = store.list().filter((r) => r.status === 'open');
  const gone = open.length ? await goneMarks(open) : [];
  const reviews = open.map((r, i) => inboxItem(r, gone[i]))
    .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt) || b.id.localeCompare(a.id));
  return { ok: true, reviews };
});
