// Times openReview on a large range diff and on an uncommitted review with many untracked files.
// Usage: node harness/bench/open-review.mjs --tree <checkout> [--runs 5]
// `--tree` is the code-review checkout whose src/ is measured; the fake cc always comes from this tree.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { makeRepo } from '../../tests/_git.js';
import { fakeCc } from '../../tests/_fakeCc.js';

const { values } = parseArgs({ options: { tree: { type: 'string' }, runs: { type: 'string', default: '5' } } });
if (!values.tree) throw new Error('--tree <code-review checkout> is required');
const runs = Number(values.runs);
const reviews = await import(pathToFileURL(path.resolve(values.tree, 'src/reviews.js')).href);

const FILES = 300;
const LINES = 1000;
const UNTRACKED = 200;
const body = (tag) => Array.from({ length: LINES }, (_, i) => `${tag} line ${i} ${'x'.repeat(16)}`).join('\n') + '\n';

const repo = makeRepo();
const files = (tag) => Object.fromEntries(Array.from({ length: FILES }, (_, i) => [`src/f${i}.txt`, body(tag)]));
repo.commit(files('base'));
const wtDir = repo.worktreeAdd(path.join(path.dirname(repo.dir), 'wt'), 'feature', 'main');
const wt = (await import('../../tests/_git.js')).bindRepo(fs.realpathSync(wtDir), () => {});
wt.commit(files('changed'));
for (let i = 0; i < UNTRACKED; i++) repo.write(`untracked/u${i}.txt`, `untracked ${i}\n`);

const cc = await fakeCc({
  projects: [{ name: 'app', path: repo.dir, system: 'local' }],
  worktrees: { app: [{ worktreeName: 'feature', worktreePath: wt.dir, branch: 'feature', baseBranch: 'main', baseSha: repo.git('rev-parse', 'main') }] },
});

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

async function measure(label, args, bump) {
  const ms = [];
  for (let i = 0; i < runs; i++) {
    bump(i);
    const store = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-bench-store-'));
    process.env.CODE_REVIEW_STORE = store;
    cc.state.execCalls = [];
    const t0 = performance.now();
    const res = await reviews.openReview(args, { kind: 'human' });
    const dt = performance.now() - t0;
    if (!res.ok) throw new Error(`${label}: ${res.code} ${res.reason}`);
    fs.rmSync(store, { recursive: true, force: true });
    ms.push(dt);
    console.log(`${label} run ${i + 1}: ${dt.toFixed(0)} ms, ${res.review.counts.files} files, ${cc.state.execCalls.length} exec calls`);
  }
  console.log(`${label} median: ${median(ms).toFixed(0)} ms`);
}

try {
  // A tiny extra commit per run moves HEAD, so the committed-snapshot cache misses.
  await measure('range', { project: 'app', worktree: 'feature', base: 'main' }, (i) => wt.commit({ [`bump${i}.txt`]: `${i}\n` }));
  await measure('uncommitted', { project: 'app', worktree: null, kind: 'uncommitted' }, () => {});
} finally {
  cc.close();
  repo.cleanup();
}
