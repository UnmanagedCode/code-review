import * as cc from './cc.js';
import * as git from './git.js';
import { Refusal } from './refusals.js';

const CONDUCTOR_PROJECT = '.conduct';
const DEAD = new Set(['exited', 'crashed']);

export const isConductorProject = (project) => project === CONDUCTOR_PROJECT;

/**
 * Finds a project's checkout: the main one (`worktree` null) or a named worktree. `place` addresses it on its
 * system (a worktree is on its project's); `exists` is asked of that system, and a system that cannot answer refuses.
 */
export async function resolveCheckout({ project, worktree }) {
  const row = (await cc.projects()).find((p) => p.name === project);
  if (!row) throw new Refusal('PROJECT_UNKNOWN', `unknown project: ${project}`);
  const placeAt = (path) => ({ system: row.system ?? 'local', remoteId: row.remoteId ?? null, path });
  const mainPlace = placeAt(row.path);
  if (worktree == null) {
    return { project, worktree: null, path: row.path, place: mainPlace, branch: null, exists: await git.exists(mainPlace), mainPath: row.path, mainPlace };
  }
  const wt = (await cc.worktrees(project)).find((w) => w.worktreeName === worktree);
  if (!wt) throw new Refusal('CHECKOUT_UNKNOWN', `unknown worktree ${worktree} of ${project}`);
  const place = placeAt(wt.worktreePath);
  return {
    project, worktree, path: wt.worktreePath, place, branch: wt.branch, baseBranch: wt.baseBranch, baseSha: wt.baseSha,
    baseWorktree: wt.baseWorktree, exists: await git.exists(place), mainPath: row.path, mainPlace,
  };
}

/** Base shortcuts for a checkout, nearest first: [{ref, label, forkSha}]. */
export async function forkPoints(checkout) {
  if (!checkout.worktree) return [];
  const rows = await cc.worktrees(checkout.project);
  const out = [];
  const seen = new Set();
  let row = rows.find((w) => w.worktreeName === checkout.worktree);
  while (row && !seen.has(row.worktreeName)) {
    seen.add(row.worktreeName);
    out.push({ ref: row.baseBranch, label: row.baseWorktree ?? row.baseBranch, forkSha: row.baseSha });
    row = row.baseWorktree ? rows.find((w) => w.worktreeName === row.baseWorktree) : null;
  }
  return out;
}

/** Every cc session; `attached` = live and on the given checkout. */
export async function sessions({ project, worktree }) {
  return (await cc.instances()).map((i) => {
    const wt = i.worktree?.worktreeName ?? null;
    const live = !DEAD.has(i.status);
    return {
      sessionId: i.sessionId, project: i.project, worktree: wt, title: i.title, status: i.status, live,
      conductor: isConductorProject(i.project), conducted: Boolean(i.conducted),
      attached: live && i.project === project && wt === (worktree ?? null),
    };
  });
}

/** {project, worktree} of a session, or null when cc does not know it. */
export async function sessionCheckout(sessionId) {
  const i = (await cc.instances()).find((x) => x.sessionId === sessionId);
  return i ? { project: i.project, worktree: i.worktree?.worktreeName ?? null } : null;
}

/** Picker data for one checkout: its git state, base shortcuts and the project's worktrees. */
export async function checkoutInfo({ project, worktree }) {
  const co = await resolveCheckout({ project, worktree });
  const st = co.exists ? await git.statusOf(co.place) : null;
  return {
    checkout: {
      project, worktree: co.worktree, path: co.path, branch: co.branch ?? st?.branch ?? null,
      headSha: st?.head ?? null, dirty: st?.dirty ?? false, exists: co.exists,
    },
    forkPoints: await forkPoints(co),
    worktrees: (await cc.worktrees(project)).map((w) => ({ worktreeName: w.worktreeName, branch: w.branch })),
  };
}

/** The newest commits of a checkout, for choosing an arbitrary base. */
export async function checkoutCommits({ project, worktree, limit = 50 }) {
  const co = await resolveCheckout({ project, worktree });
  if (!co.exists) throw new Refusal('CHECKOUT_GONE', `${co.path} does not exist`);
  return git.commitLog(co.place, { limit: Math.min(Math.max(Number(limit) || 50, 1), 500) });
}
