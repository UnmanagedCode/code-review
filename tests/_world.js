import fs from 'node:fs';
import path from 'node:path';
import { makeRepo, bindRepo, lines } from './_git.js';
import { tempStore } from './_store.js';
import { fakeCc } from './_fakeCc.js';

export const HUMAN = { kind: 'human' };
export const agent = (sessionId, project = 'app') => ({ kind: 'agent', sessionId, project });

/**
 * A project 'app' (temp repo with a.js of 20 lines and b.js of 10 on main), a fake cc and a temp store.
 * `addWorktree(name)` creates a linked worktree on branch `br-<name>` and registers it with the fake cc.
 */
export async function world() {
  const repo = makeRepo();
  repo.commit({ 'a.js': lines(20), 'b.js': lines(10, 'b') });
  const store = tempStore();
  const cc = await fakeCc({ projects: [{ name: 'app', path: repo.dir, system: 'local' }], worktrees: { app: [] }, instances: [] });
  return {
    repo, cc, store,
    addWorktree(name = 'feature') {
      const dir = path.join(path.dirname(repo.dir), `wt-${name}`); // inside the repo's own temp dir, removed with it
      repo.worktreeAdd(dir, `br-${name}`, 'main');
      const real = fs.realpathSync(dir);
      cc.state.worktrees.app.push({
        worktreeName: name, worktreePath: real, branch: `br-${name}`, baseBranch: 'main',
        baseSha: repo.git('rev-parse', 'main'), parentPath: repo.dir,
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
