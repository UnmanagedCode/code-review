import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATE = '2024-01-01T00:00:00Z';

/** Runs git in `dir` with a pinned identity, no signing and fixed dates. */
export function git(dir, ...args) {
  return execFileSync('git', ['-C', dir, '-c', 'user.name=T', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_DATE: DATE, GIT_COMMITTER_DATE: DATE, LC_ALL: 'C' },
  }).trim();
}

/** Helper object around an existing checkout directory (a repo or a linked worktree). */
export function bindRepo(dir, cleanup = () => fs.rmSync(dir, { recursive: true, force: true })) {
  const repo = {
    dir,
    git: (...a) => git(dir, ...a),
    write(rel, content) {
      const p = path.join(dir, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, content);
    },
    remove(rel) { fs.rmSync(path.join(dir, rel), { recursive: true, force: true }); },
    /** Writes `files` ({rel: content|null}), stages everything and commits; returns the sha. */
    commit(files, msg = 'c') {
      for (const [rel, content] of Object.entries(files)) {
        if (content === null) repo.remove(rel); else repo.write(rel, content);
      }
      git(dir, 'add', '-A');
      git(dir, 'commit', '-q', '--allow-empty', '-m', msg);
      return git(dir, 'rev-parse', 'HEAD');
    },
    branch: (name, from = 'HEAD') => git(dir, 'checkout', '-q', '-b', name, from),
    checkout: (name) => git(dir, 'checkout', '-q', name),
    worktreeAdd(wtDir, branch, from = 'HEAD') {
      git(dir, 'worktree', 'add', '-q', '-b', branch, wtDir, from);
      return wtDir;
    },
    cleanup,
  };
  return repo;
}

/**
 * A fresh temp repo on branch `main`, inside its own mkdtemp directory (siblings such as worktrees live there too).
 * `cleanup()` removes exactly that directory. `dirName` names the repo directory (default `repo`).
 */
export function makeRepo({ dirName = 'repo' } = {}) {
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cr-repo-')));
  const dir = path.join(parent, dirName);
  fs.mkdirSync(dir);
  git(dir, 'init', '-q', '-b', 'main');
  return bindRepo(dir, () => fs.rmSync(parent, { recursive: true, force: true }));
}

export const lines = (n, prefix = 'l') => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`).join('\n') + '\n';
