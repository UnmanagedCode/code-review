import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Refusal } from './refusals.js';

export const MAX_DIFF_BYTES = 64 * 1024 * 1024;
export const MAX_FILE_BYTES = 1024 * 1024;
export const MAX_UNTRACKED_FILES = 500;

// Pinned so user git config (external diff, textconv, prefixes, relative paths) cannot change the parsed shape.
export const DIFF_FLAGS = ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--no-relative', '--full-index', '-M', '--src-prefix=a/', '--dst-prefix=b/', '-U3'];

// GIT_OPTIONAL_LOCKS=0 stops `status` from refreshing .git/index, but `git diff <commit>` still rewrites it;
// working-tree diffs therefore run against a private index copy (see withPrivateIndex).
const baseEnv = () => ({ ...process.env, LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0' });

// fsmonitor off on every call: with core.fsmonitor=true even `git status` starts a detached daemon that writes into .git.
// (A clean/smudge filter named by the reviewed repo's own .gitattributes still runs on working-tree paths.)
const BASE_ARGS = ['-c', 'core.fsmonitor=false'];

const REF_RE = /^[A-Za-z0-9._\/@{}^~-]+$/;

/** Throws BAD_REF unless `x` is a plain ref/sha that cannot be read as an option. */
export function checkRef(x) {
  if (typeof x !== 'string' || !REF_RE.test(x) || x.startsWith('-')) throw new Refusal('BAD_REF', `not a valid ref: ${JSON.stringify(x)}`);
  return x;
}

/** Runs git in `repo`. Resolves {code, stdout}; exit codes outside `ok` throw an Error carrying stderr. */
export function run(repo, args, { input, ok = [0], maxBuffer = MAX_DIFF_BYTES, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile('git', [...BASE_ARGS, '-C', repo, ...args], { env: { ...baseEnv(), ...env }, maxBuffer, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (!err) return resolve({ code: 0, stdout });
      if (err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return reject(new Refusal('DIFF_TOO_LARGE', 'output exceeds the size limit'));
      if (typeof err.code === 'number' && ok.includes(err.code)) return resolve({ code: err.code, stdout });
      reject(Object.assign(new Error(`git ${args[0]} failed: ${String(stderr).trim() || err.message}`), { exitCode: err.code, stderr }));
    });
    child.stdin.on('error', () => {}); // git may exit before reading stdin
    child.stdin.end(input);
  });
}

const out = async (repo, args, opts) => (await run(repo, args, opts)).stdout.trim();

// C-quoted so a path with a newline, quote, backslash or leading '#' stays one entry (git unquotes entries starting with ").
const cQuote = (p) => `"${[...Buffer.from(p)].map((b) => {
  if (b === 0x22 || b === 0x5c) return `\\${String.fromCharCode(b)}`;
  return b < 0x20 || b >= 0x7f ? `\\${b.toString(8).padStart(3, '0')}` : String.fromCharCode(b);
}).join('')}"`;

/**
 * Calls `fn({env})` with GIT_INDEX_FILE pointing at a unique temp copy of the checkout's index and GIT_OBJECT_DIRECTORY
 * at a temp dir whose `info/alternates` names the real objects dir, both deleted afterwards, so index-refreshing
 * and staging commands never write the project tree. A missing index is not copied: git starts empty.
 */
export async function withPrivateIndex(repo, fn) {
  const real = path.resolve(repo, await out(repo, ['rev-parse', '--git-path', 'index']));
  const realObjects = path.resolve(repo, await out(repo, ['rev-parse', '--git-path', 'objects']));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-index-'));
  const copy = path.join(dir, 'index');
  const objects = path.join(dir, 'objects');
  fs.mkdirSync(path.join(objects, 'info'), { recursive: true });
  try {
    // A file, not GIT_ALTERNATE_OBJECT_DIRECTORIES: that variable is colon-separated and would split a path containing ':'.
    fs.writeFileSync(path.join(objects, 'info', 'alternates'), `${cQuote(realObjects)}\n`);
    if (fs.existsSync(real)) {
      fs.copyFileSync(real, copy);
      // git treats an entry as racily clean (re-hashes it) only if it is not older than the index file, so the copy
      // must not look newer than the original; one ms back errs towards re-hashing.
      const stat = fs.statSync(real);
      fs.utimesSync(copy, stat.atime, new Date(Math.floor(stat.mtimeMs) - 1));
    }
    // Objects written while staging (`update-index --add`) land in the private dir; the real store is read through its alternates file.
    return await fn({ env: { GIT_INDEX_FILE: copy, GIT_OBJECT_DIRECTORY: objects } });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Full sha for a ref, or REF_UNKNOWN. */
export async function resolveCommit(repo, ref) {
  checkRef(ref);
  try {
    return await out(repo, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]);
  } catch {
    throw new Refusal('REF_UNKNOWN', `unknown ref: ${ref}`);
  }
}

/** HEAD's sha, or null on an unborn branch. */
export async function headOf(repo) {
  const r = await run(repo, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], { ok: [0, 1] });
  return r.code === 0 ? r.stdout.trim() : null;
}

export const emptyTree = (repo) => out(repo, ['hash-object', '-t', 'tree', '--stdin']);

/** Merge base of two commits, or null when unrelated. */
export async function mergeBase(repo, a, b) {
  const r = await run(repo, ['merge-base', a, b], { ok: [0, 1] });
  return r.code === 0 ? r.stdout.trim() : null;
}

/** First parent of `sha`, or null for a root commit. */
export async function parentOf(repo, sha) {
  const line = await out(repo, ['rev-list', '--parents', '-n1', sha]);
  return line.split(' ')[1] ?? null;
}

/** True when `sha` names a commit or tree present in the object store. */
export async function objectExists(repo, sha) {
  const r = await run(repo, ['cat-file', '-e', `${sha}^{tree}`], { ok: [0, 1, 128] });
  return r.code === 0;
}

/** File content at `sha:path`, or null when absent. */
export async function show(repo, sha, path) {
  const r = await run(repo, ['show', `${sha}:${path}`], { ok: [0, 128] });
  return r.code === 0 ? r.stdout : null;
}

export async function isDirty(repo) {
  return (await out(repo, ['status', '--porcelain', '-z', '--untracked-files=normal'])) !== '';
}

/** Raw unified diff between two trees/commits. */
export const diffBetween = (repo, from, to, opts) => run(repo, [...DIFF_FLAGS, from, to], opts).then((r) => r.stdout);

/** Tracked changes (staged + unstaged) against `from`. */
export const diffWorktree = (repo, from, opts) => run(repo, [...DIFF_FLAGS, from], opts).then((r) => r.stdout);

/** Stages the working-tree content of `paths` into the index `opts.env` points at (never the real one). */
export const addToIndex = (repo, paths, opts) =>
  run(repo, ['update-index', '--add', '-z', '--stdin'], { ...opts, input: paths.join('\0') + '\0' });

/** Untracked, non-ignored paths (relative); directories (nested repos) are skipped. */
export async function untracked(repo, opts) {
  const r = await run(repo, ['ls-files', '--others', '--exclude-standard', '-z'], opts);
  return r.stdout.split('\0').filter((p) => p && !p.endsWith('/'));
}

/** Diff of one untracked file as an addition (`--no-index` exits 1 when files differ). */
export const diffUntracked = (repo, rel, opts) =>
  run(repo, [...DIFF_FLAGS, '--no-index', '--', '/dev/null', rel], { ...opts, ok: [0, 1] }).then((r) => r.stdout);

/** Rename map for `from..to`: {newPath: oldPath}. */
export async function renames(repo, from, to) {
  const r = await run(repo, ['diff', '-M', '--name-status', '-z', from, to]);
  const parts = r.stdout.split('\0');
  const map = {};
  for (let i = 0; i < parts.length; i++) {
    const s = parts[i];
    if (s.startsWith('R')) { map[parts[i + 2]] = parts[i + 1]; i += 2; } else i += 1;
  }
  return map;
}

/** Commits, newest first. `range` is `a..b`; otherwise the last `limit` commits from HEAD. */
export async function commitLog(repo, { range, limit = 50 } = {}) {
  const fmt = '--format=%H%x1f%h%x1f%an%x1f%aI%x1f%P%x1f%s%x1e';
  const args = range ? ['log', fmt, range] : ['log', fmt, '-n', String(limit), 'HEAD'];
  const r = await run(repo, args, { ok: [0, 128] });
  return r.stdout.split('\x1e').map((s) => s.trim()).filter(Boolean).map((rec) => {
    const [sha, short, author, date, parents, subject] = rec.split('\x1f');
    return { sha, short, author, date, subject, merge: parents.split(' ').filter(Boolean).length > 1 };
  });
}

/** Current branch name, or 'HEAD' when detached. Works on an unborn branch. */
export async function currentBranch(repo) {
  const r = await run(repo, ['symbolic-ref', '-q', '--short', 'HEAD'], { ok: [0, 1] });
  return r.code === 0 ? r.stdout.trim() : 'HEAD';
}
