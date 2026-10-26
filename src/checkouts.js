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

/** Every cc session; `attached` = live and on the given checkout. `label` is cc's sidebar label; a cc without `displayLabel` falls back to its `title`. */
export async function sessions({ project, worktree }) {
  return (await cc.instances()).map((i) => {
    const wt = i.worktree?.worktreeName ?? null;
    const live = !DEAD.has(i.status);
    return {
      sessionId: i.sessionId, project: i.project, worktree: wt, label: i.displayLabel || i.title || null, status: i.status, live,
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

// cc's `lastSpawnAt` is an ISO string, so it compares as a string; one that is missing sorts last.
const byNewestThenName = (a, b) => {
  const [x, y] = [a.lastSpawnAt ?? '', b.lastSpawnAt ?? ''];
  return x < y ? 1 : x > y ? -1 : a.project.localeCompare(b.project);
};

/**
 * The checkouts a session is working on: its own, then those of the live workers it owns (by project name),
 * then those it has spawned workers into (`lastSpawnAt` newest first, then project name). Mirrors cc's `conductorChips` in `shared/conductors.ts`.
 * Rows {project, main, worktrees}: `main` = a live row is on the main checkout, or a history entry records no worktrees.
 * An unknown session gives []; a failing history route degrades to the live places, a failing instances route refuses.
 */
export async function sessionPlaces(sessionId) {
  const [live, hist] = await Promise.allSettled([cc.instances(), cc.conductorProjects()]);
  if (live.status === 'rejected') throw live.reason;
  const rows = live.value;
  let spawned = {};
  if (hist.status === 'fulfilled') spawned = hist.value;
  else console.warn(`code-review: session places without spawn history: ${hist.reason.message}`);
  const places = new Map();
  const place = (project) => {
    if (!places.has(project)) places.set(project, { project, main: false, worktrees: new Set() });
    return places.get(project);
  };
  const addRow = (i) => {
    const p = place(i.project);
    if (i.worktree?.worktreeName) p.worktrees.add(i.worktree.worktreeName); else p.main = true;
  };
  const own = rows.find((i) => i.sessionId === sessionId);
  if (own) addRow(own);
  rows.filter((i) => i.ownerSessionId === sessionId).sort((a, b) => a.project.localeCompare(b.project)).forEach(addRow);
  const history = [...(spawned?.[sessionId] ?? [])]
    .sort(byNewestThenName);
  for (const e of history) {
    const p = place(e.project);
    const recorded = Array.isArray(e.worktrees) ? e.worktrees : [];
    recorded.forEach((w) => p.worktrees.add(w));
    if (!recorded.length) p.main = true; // no recorded worktree: main is the only place that worker could have been
  }
  return [...places.values()]
    .filter((p) => !isConductorProject(p.project))
    .map((p) => ({ project: p.project, main: p.main, worktrees: [...p.worktrees].sort((a, b) => a.localeCompare(b)) }));
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

/** One commit of a checkout, named by any ref or sha: the same validation as opening a review (`BAD_REF`, `REF_UNKNOWN`). */
export async function checkoutCommit({ project, worktree, ref }) {
  const co = await resolveCheckout({ project, worktree });
  if (!co.exists) throw new Refusal('CHECKOUT_GONE', `${co.path} does not exist`);
  return git.commitOf(co.place, await git.resolveCommit(co.place, ref));
}
