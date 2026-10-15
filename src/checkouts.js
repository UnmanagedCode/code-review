import fs from 'node:fs';
import * as cc from './cc.js';
import { Refusal } from './refusals.js';

const CONDUCTOR_PROJECT = '.conduct';
const DEAD = new Set(['exited', 'crashed']);

export const isConductorProject = (project) => project === CONDUCTOR_PROJECT;

/** Finds a local project's checkout: the main one (`worktree` null) or a named worktree. */
export async function resolveCheckout({ project, worktree }) {
  const row = (await cc.projects()).find((p) => p.name === project);
  if (!row) throw new Refusal('PROJECT_UNKNOWN', `unknown project: ${project}`);
  if (row.system && row.system !== 'local') throw new Refusal('PROJECT_NOT_LOCAL', `project ${project} lives on ${row.system}`);
  if (worktree == null) return { project, worktree: null, path: row.path, branch: null, exists: fs.existsSync(row.path), mainPath: row.path };
  const wt = (await cc.worktrees(project)).find((w) => w.worktreeName === worktree);
  if (!wt) throw new Refusal('CHECKOUT_UNKNOWN', `unknown worktree ${worktree} of ${project}`);
  return {
    project, worktree, path: wt.worktreePath, branch: wt.branch, baseBranch: wt.baseBranch, baseSha: wt.baseSha,
    baseWorktree: wt.baseWorktree, exists: fs.existsSync(wt.worktreePath), mainPath: row.path,
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
