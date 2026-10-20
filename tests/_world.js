import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { makeRepo, bindRepo, lines } from './_git.js';
import { tempStore } from './_store.js';
import { fakeCc } from './_fakeCc.js';

export const HUMAN = { kind: 'human' };
export const agent = (sessionId, project = 'app') => ({ kind: 'agent', sessionId, project });

/**
 * A project 'app' (temp repo with a.js of 20 lines and b.js of 10 on main), a fake cc and a temp store.
 * `addWorktree(name)` creates a linked worktree on branch `br-<name>` and registers it with the fake cc.
 * With `system`, the project lives on that (fake) system: cc rows carry paths under a virtual root that does not
 * exist on this machine, so only `/api/exec` can reach them. `repo.dir` stays the real dir for setup.
 */
export async function world({ system, remoteId } = {}) {
  const repo = makeRepo();
  repo.commit({ 'a.js': lines(20), 'b.js': lines(10, 'b') });
  const store = tempStore();
  const parent = path.dirname(repo.dir);
  const root = system ? `/cr-remote-${randomBytes(6).toString('hex')}` : null;
  /** The path cc reports for a real path under the repo's temp dir. */
  const virtual = (real) => (root ? root + real.slice(parent.length) : real);
  const row = system ? { name: 'app', path: virtual(repo.dir), system, ...(remoteId ? { remoteId } : {}) } : { name: 'app', path: repo.dir, system: 'local' };
  const cc = await fakeCc({
    projects: [row], worktrees: { app: [] }, instances: [],
    systems: system ? { [system]: { root, dir: parent, remoteId: remoteId ?? null } } : {},
  });
  return {
    repo, cc, store, root, virtual,
    addWorktree(name = 'feature') {
      const dir = path.join(parent, `wt-${name}`); // inside the repo's own temp dir, removed with it
      repo.worktreeAdd(dir, `br-${name}`, 'main');
      const real = fs.realpathSync(dir);
      cc.state.worktrees.app.push({
        worktreeName: name, worktreePath: virtual(real), branch: `br-${name}`, baseBranch: 'main',
        baseSha: repo.git('rev-parse', 'main'), parentPath: virtual(repo.dir),
      });
      const wt = bindRepo(real, () => {});
      /** Simulates cc deleting the worktree. */
      wt.destroy = () => {
        repo.git('worktree', 'remove', '--force', real);
        cc.state.worktrees.app = cc.state.worktrees.app.filter((w) => w.worktreeName !== name);
      };
      return wt;
    },
    session(sessionId, { worktree = null, project = 'app', status = 'idle' } = {}) {
      cc.state.instances.push({ sessionId, project, status, title: sessionId, conducted: false, worktree: worktree ? { worktreeName: worktree } : null });
    },
    cleanup() {
      cc.close();
      store.cleanup();
      repo.cleanup();
    },
  };
}

/** `a.js` with the given 1-based lines replaced. */
export const editLines = (edits, n = 20) =>
  lines(n).split('\n').slice(0, n).map((l, i) => edits[i + 1] ?? l).join('\n') + '\n';
