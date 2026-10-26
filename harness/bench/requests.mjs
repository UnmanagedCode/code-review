// Per-request cc round trips and wall time against a fake cc with docker-like latencies.
// Usage: node harness/bench/requests.mjs --tree <checkout> [--runs 3]
// `--tree` is the code-review checkout whose src/ is measured; the fake cc and fixtures always come from this tree.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { makeRepo, bindRepo, lines } from '../../tests/_git.js';
import { fakeCc } from '../../tests/_fakeCc.js';

const { values } = parseArgs({ options: { tree: { type: 'string' }, runs: { type: 'string', default: '3' } } });
if (!values.tree) throw new Error('--tree <code-review checkout> is required');
const runs = Math.max(2, Number(values.runs));
const src = (m) => import(pathToFileURL(path.resolve(values.tree, 'src', m)).href);
const reviews = await src('reviews.js');
const inbox = await src('inbox.js');
const checkouts = await src('checkouts.js');

// cc's cost model on a docker System: every exec ~60 ms; the full project list cold ~800 ms; a worktrees list ~100 ms.
const EXEC_DELAY_MS = 60;
const GET_DELAY_MS = { '/api/projects': 800 };
const WORKTREES_DELAY_MS = 100;

const store = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-bench-store-'));
process.env.CODE_REVIEW_STORE = store;
const HUMAN = { kind: 'human' };
const must = (res, what) => { if (!res.ok) throw new Error(`${what}: ${res.code} ${res.reason}`); return res; };

// Project `app`: a worktree with a few commits of edits, a main checkout with uncommitted edits and untracked files.
const app = makeRepo();
const body = (n, tag) => lines(n, tag);
app.commit(Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`src/f${i}.js`, body(200, `f${i}-`)])));
const wtDir = fs.realpathSync(app.worktreeAdd(path.join(path.dirname(app.dir), 'wt'), 'feature', 'main'));
const wt = bindRepo(wtDir, () => {});
for (let c = 0; c < 3; c++) wt.commit(Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`src/f${i}.js`, body(200, `f${i}-`).replace(`f${i}-${10 + c * 20}\n`, `edit ${c}\n`)])));
app.commit({ 'src/main.js': body(50, 'm') });
for (let i = 0; i < 3; i++) app.write(`src/f${i}.js`, body(200, `f${i}-`).replace(`f${i}-7\n`, 'live\n'));
for (let i = 0; i < 5; i++) app.write(`untracked/u${i}.txt`, `u${i}\n`);

const cc = await fakeCc({
  projects: [{ name: 'app', path: app.dir, system: 'local' }],
  worktrees: { app: [{ worktreeName: 'feature', worktreePath: wtDir, branch: 'feature', baseBranch: 'main', baseSha: app.git('rev-parse', 'main') }] },
});

// Reviews: closed copies first (a closed review is never reused), then the open one of each kind. Rows: worktree 3, project 12.
const open = async (args) => must(await reviews.openReview(args, HUMAN), 'open').review;
const closedCopies = async (args, n) => {
  for (let i = 0; i < n; i++) must(await reviews.patchReview((await open(args)).id, { status: 'closed' }), 'close');
};
const RANGE = { project: 'app', worktree: 'feature', base: 'main' };
const COMMIT = { project: 'app', kind: 'commit' };
const UNC = { project: 'app', kind: 'uncommitted' };
await closedCopies(RANGE, 2);
await closedCopies(COMMIT, 4);
await closedCopies(UNC, 3);
const range = await open(RANGE);
const commit = await open(COMMIT);
const unc = await open(UNC);

cc.state.execDelayMs = EXEC_DELAY_MS;
cc.state.delayMs = (p) => GET_DELAY_MS[p] ?? (p.endsWith('/worktrees') ? WORKTREES_DELAY_MS : 0);

const REQUESTS = [
  ['review range', () => reviews.getReview(range.id)],
  ['diff range', () => reviews.diff(range.id, {})],
  ['review commit', () => reviews.getReview(commit.id)],
  ['diff commit', () => reviews.diff(commit.id, {})],
  ['review uncommitted', () => reviews.getReview(unc.id)],
  ['diff uncommitted', () => reviews.diff(unc.id, {})],
  ['list 3 rows', () => reviews.listReviews({ project: 'app', worktree: 'feature' })],
  ['list 12 rows', () => reviews.listReviews({ project: 'app' })],
  ['inbox', () => inbox.listInbox()],
  ['/checkout', async () => ({ ok: true, ...(await checkouts.checkoutInfo({ project: 'app', worktree: 'feature' })) })],
];

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const routeOf = (h) => h.replace(/^GET \/api\/projects\/[^/]+\//, 'GET …/').replace(/^GET /, '');
const tally = (hits) => {
  const by = {};
  for (const h of hits.filter((x) => x.startsWith('GET '))) by[routeOf(h)] = (by[routeOf(h)] ?? 0) + 1;
  return Object.entries(by).map(([r, n]) => `${r}×${n}`).join(' ') || '–';
};

async function once(fn) {
  const hits = cc.state.hits.length;
  const execs = cc.state.execCalls.length;
  const t0 = performance.now();
  const res = await fn();
  const ms = performance.now() - t0;
  if (res?.ok === false) throw new Error(`${res.code} ${res.reason}`);
  return { ms, gets: tally(cc.state.hits.slice(hits)), execs: cc.state.execCalls.length - execs };
}

const rows = [];
try {
  for (const [name, fn] of REQUESTS) {
    // Cold: no lookup reuse (a tree without the lookup cache ignores the variable). Warm: the default TTL, after one request.
    process.env.CODE_REVIEW_LOOKUP_TTL_MS = '0';
    const cold = await once(fn);
    delete process.env.CODE_REVIEW_LOOKUP_TTL_MS;
    const warm = [];
    for (let i = 1; i < runs; i++) warm.push(await once(fn));
    const last = warm.at(-1);
    rows.push([name, cold.ms.toFixed(0), cold.gets, cold.execs, median(warm.map((x) => x.ms)).toFixed(0), last.gets, last.execs]);
  }
} finally {
  cc.close();
  app.cleanup();
  fs.rmSync(store, { recursive: true, force: true });
}
console.log(`tree: ${path.resolve(values.tree)} · exec ${EXEC_DELAY_MS} ms · GET /api/projects ${GET_DELAY_MS['/api/projects']} ms · worktrees ${WORKTREES_DELAY_MS} ms`);
console.log('| Request | cold ms | cold cc GETs | cold execs | warm ms (median) | warm cc GETs | warm execs |');
console.log('|---|---:|---|---:|---:|---|---:|');
for (const r of rows) console.log(`| ${r.join(' | ')} |`);
