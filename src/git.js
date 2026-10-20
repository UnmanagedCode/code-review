import { exec } from './exec.js';
import { Refusal } from './refusals.js';

export const MAX_DIFF_BYTES = 64 * 1024 * 1024;
export const MAX_FILE_BYTES = 1024 * 1024;
export const MAX_UNTRACKED_FILES = 500;

// Pinned so user git config (external diff, textconv, prefixes, relative paths) cannot change the parsed shape.
export const DIFF_FLAGS = ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--no-relative', '--full-index', '-M', '--src-prefix=a/', '--dst-prefix=b/', '-U3'];

// GIT_OPTIONAL_LOCKS=0 stops `status` from refreshing .git/index, but `git diff <commit>` still rewrites it;
// working-tree diffs therefore run against a private index copy (see withPrivateIndex).
// An overlay on the target's own environment, on every call (scripts included).
const BASE_ENV = { LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0' };

// fsmonitor off on every call: with core.fsmonitor=true even `git status` starts a detached daemon that writes into .git.
// (A clean/smudge filter named by the reviewed repo's own .gitattributes still runs on working-tree paths.)
const BASE_ARGS = ['-c', 'core.fsmonitor=false'];
const GIT = 'git -c core.fsmonitor=false';

// Paths per batched script call, well under any ARG_MAX.
const SIZE_CHUNK = 200;
const UNTRACKED_CHUNK = 100;

const REF_RE = /^[A-Za-z0-9._\/@{}^~-]+$/;

/** Throws BAD_REF unless `x` is a plain ref/sha that cannot be read as an option. */
export function checkRef(x) {
  if (typeof x !== 'string' || !REF_RE.test(x) || x.startsWith('-')) throw new Refusal('BAD_REF', `not a valid ref: ${JSON.stringify(x)}`);
  return x;
}

/** A place on cc's own machine. */
export const localPlace = (path) => ({ system: 'local', remoteId: null, path });

/** Single-quotes `s` for a POSIX sh script. */
const shq = (s) => `'${s.replace(/'/g, `'\\''`)}'`;

async function call(place, argv, what, { input, ok = [0], maxBuffer = MAX_DIFF_BYTES, env } = {}) {
  const r = await exec(place, argv, { env: { ...BASE_ENV, ...env }, stdin: input, maxOutputBytes: maxBuffer });
  const stdout = r.stdout.toString('utf8');
  if (ok.includes(r.code)) return { code: r.code, stdout };
  const stderr = r.stderr.toString('utf8');
  throw Object.assign(new Error(`${what} failed: ${stderr.trim() || `exit ${r.code}`}`), { exitCode: r.code, stderr });
}

/** Runs git in the checkout at `place`. Resolves {code, stdout}; exit codes outside `ok` throw an Error carrying stderr. */
export const run = (place, args, opts) => call(place, ['git', ...BASE_ARGS, '-C', place.path, ...args], `git ${args[0]}`, opts);

/** Runs a POSIX sh `script` on `place`'s system with `$1` = the checkout path and `args` after it. Same contract as `run`. */
export const sh = (place, script, args = [], opts) => call(place, ['sh', '-c', script, 'sh', place.path, ...args], 'sh script', opts);

const out = async (place, args, opts) => (await run(place, args, opts)).stdout.trim();

// C-quoted so a path with a newline, quote, backslash or leading '#' stays one entry (git unquotes entries starting with ").
const cQuote = (p) => `"${[...Buffer.from(p)].map((b) => {
  if (b === 0x22 || b === 0x5c) return `\\${String.fromCharCode(b)}`;
  return b < 0x20 || b >= 0x7f ? `\\${b.toString(8).padStart(3, '0')}` : String.fromCharCode(b);
}).join('')}"`;

// Every script enters the checkout first; `$1` is its path.
const CD = 'cd -- "$1" || exit 3; shift';

// Makes the private index dir on the target: prints "<dir>\0<absolute objects dir>\0". The copy takes the original's
// times exactly (`touch -r`), so git's racy-clean decisions on it are the original's own; a missing index is not copied.
const CREATE_INDEX = `${CD}
i=$(${GIT} rev-parse --git-path index) || exit 4
o=$(${GIT} rev-parse --git-path objects) || exit 4
case $i in /*) ;; *) i=$PWD/$i ;; esac
case $o in /*) ;; *) o=$PWD/$o ;; esac
d=$(mktemp -d "\${TMPDIR:-/tmp}/cr-index-XXXXXX") || exit 5
if ! mkdir -p "$d/objects/info" || { [ -e "$i" ] && ! { cp -- "$i" "$d/index" && touch -r "$i" "$d/index"; }; }; then rm -rf -- "$d"; exit 6; fi
printf '%s\\0%s\\0' "$d" "$o"`;

// Writes the alternates entry ($2, already C-quoted) into the private objects dir ($1).
const WRITE_ALTERNATES = `${CD}
printf '%s\\n' "$2" > "$1/objects/info/alternates"`;

const TEMP_RE = /^\/(.+\/)?cr-index-[^/]+$/;

/**
 * Calls `fn({env})` with GIT_INDEX_FILE pointing at a unique temp copy of the checkout's index and GIT_OBJECT_DIRECTORY
 * at a temp dir whose `info/alternates` names the real objects dir, both on the checkout's system and deleted
 * afterwards, so index-refreshing and staging commands never write the project tree.
 */
export async function withPrivateIndex(place, fn) {
  const [dir, objects] = (await sh(place, CREATE_INDEX)).stdout.split('\0');
  if (!TEMP_RE.test(dir)) throw new Error(`private index: unexpected temp dir ${JSON.stringify(dir)}`);
  const teardown = () => removeTemp(place, dir).catch((e) => {
    console.warn(`code-review: could not remove the private index dir ${dir} on ${place.system}: ${e.message}`);
  });
  let result;
  try {
    // A file, not GIT_ALTERNATE_OBJECT_DIRECTORIES: that variable is colon-separated and would split a path containing ':'.
    // A second call because the quoted entry depends on the first call's output.
    await sh(place, WRITE_ALTERNATES, [dir, cQuote(objects)]);
    // Objects written while staging (`update-index --add`) land in the private dir; the real store is read through its alternates file.
    result = await fn({ env: { GIT_INDEX_FILE: `${dir}/index`, GIT_OBJECT_DIRECTORY: `${dir}/objects` } });
  } catch (e) {
    await teardown();
    throw e;
  }
  await teardown(); // a leaked dir sits in the target's tmp, never in the tree: logged, not fatal
  return result;
}

/** Removes a private index dir; refuses any path not named `cr-index-*`. */
export async function removeTemp(place, dir) {
  if (!TEMP_RE.test(dir)) throw new Error(`refusing to remove ${JSON.stringify(dir)}: not a private index dir`);
  await call(place, ['rm', '-rf', '--', dir], 'rm');
}

/** True when `place.path` exists on its system (symlinks followed). */
export async function exists(place) {
  return (await call(place, ['sh', '-c', '[ -e "$1" ]', 'sh', place.path], 'exists', { ok: [0, 1] })).code === 0;
}

/** Full sha for a ref, or REF_UNKNOWN. */
export async function resolveCommit(place, ref) {
  checkRef(ref);
  try {
    return await out(place, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]);
  } catch (e) {
    if (e instanceof Refusal) throw e;
    throw new Refusal('REF_UNKNOWN', `unknown ref: ${ref}`);
  }
}

/** HEAD's sha, or null on an unborn branch. */
export async function headOf(place) {
  const r = await run(place, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], { ok: [0, 1] });
  return r.code === 0 ? r.stdout.trim() : null;
}

export const emptyTree = (place) => out(place, ['hash-object', '-t', 'tree', '--stdin']);

/** Merge base of two commits, or null when unrelated. */
export async function mergeBase(place, a, b) {
  const r = await run(place, ['merge-base', a, b], { ok: [0, 1] });
  return r.code === 0 ? r.stdout.trim() : null;
}

/** First parent of `sha`, or null for a root commit. */
export async function parentOf(place, sha) {
  const line = await out(place, ['rev-list', '--parents', '-n1', sha]);
  return line.split(' ')[1] ?? null;
}

// Prints the first argument that names no commit or tree in the object store, else nothing.
const OBJECTS_EXIST = `${CD}
for s; do ${GIT} cat-file -e "$s^{tree}" 2>/dev/null || { printf '%s' "$s"; exit 0; }; done`;

/** The first of `shas` missing from the object store, or null when all are present. One call. */
export async function objectsExist(place, shas) {
  return (await sh(place, OBJECTS_EXIST, [...new Set(shas)])).stdout.trim() || null;
}

/** File content at `sha:path`, or null when absent. */
export async function show(place, sha, path) {
  const r = await run(place, ['show', `${sha}:${path}`], { ok: [0, 128] });
  return r.code === 0 ? r.stdout : null;
}

/** {head, branch, dirty} from one `git status`: head null on an unborn branch, branch 'HEAD' when detached. */
export async function statusOf(place) {
  const r = await run(place, ['status', '--porcelain=v2', '-z', '--branch', '--no-ahead-behind', '--untracked-files=normal']);
  let head = null;
  let branch = 'HEAD';
  let dirty = false;
  for (const rec of r.stdout.split('\0')) {
    if (rec.startsWith('# branch.oid ')) { const v = rec.slice(13); head = v === '(initial)' ? null : v; }
    else if (rec.startsWith('# branch.head ')) { const v = rec.slice(14); branch = v === '(detached)' ? 'HEAD' : v; }
    else if (rec && !rec.startsWith('# ')) dirty = true;
  }
  return { head, branch, dirty };
}

/** Raw unified diff between two trees/commits. */
export const diffBetween = (place, from, to, opts) => run(place, [...DIFF_FLAGS, from, to], opts).then((r) => r.stdout);

/** Tracked changes (staged + unstaged) against `from`. */
export const diffWorktree = (place, from, opts) => run(place, [...DIFF_FLAGS, from], opts).then((r) => r.stdout);

/** Stages the working-tree content of `paths` into the index `opts.env` points at (never the real one). */
export const addToIndex = (place, paths, opts) =>
  run(place, ['update-index', '--add', '-z', '--stdin'], { ...opts, input: paths.join('\0') + '\0' });

/** Untracked, non-ignored paths (relative); directories (nested repos) are skipped. */
export async function untracked(place, opts) {
  const r = await run(place, ['ls-files', '--others', '--exclude-standard', '-z'], opts);
  return r.stdout.split('\0').filter((p) => p && !p.endsWith('/'));
}

// One line per argument: its lstat size (`ls -ldn` reports a symlink itself), or `-` when it does not exist.
// Names are never echoed, so a newline in one cannot shift the lines.
const SIZES = `${CD}
for f; do s=$(ls -ldn -- "./$f" 2>/dev/null) && printf '%s\\n' "$s" | awk 'NR==1{print $5}' || echo -; done`;

/** lstat size of each relative path (null = absent; a device = 0), in argument order. */
export async function sizes(place, rels) {
  const res = [];
  for (let i = 0; i < rels.length; i += SIZE_CHUNK) {
    const chunk = rels.slice(i, i + SIZE_CHUNK);
    const got = (await sh(place, SIZES, chunk)).stdout.split('\n').slice(0, -1);
    if (got.length !== chunk.length) throw new Error(`sizes: ${got.length} answers for ${chunk.length} paths`);
    res.push(...got.map((s) => (s === '-' ? null : Number(s) || 0)));
  }
  return res;
}

// Each argument's diff as an addition, concatenated (`--no-index` exits 1 when files differ).
const DIFF_UNTRACKED = `${CD}
for f; do ${GIT} ${DIFF_FLAGS.map(shq).join(' ')} --no-index -- /dev/null "$f"; s=$?; [ "$s" -le 1 ] || exit "$s"; done`;

/**
 * Diffs of untracked files as additions, in order. `files` is [{rel, size}]; one call per chunk of at most
 * UNTRACKED_CHUNK paths and a third of `opts.maxBuffer` in summed size, so a chunk stays under the per-call fence.
 */
export async function diffUntrackedBatch(place, files, opts = {}) {
  const budget = (opts.maxBuffer ?? MAX_DIFF_BYTES) / 3;
  let text = '';
  let chunk = [];
  let sum = 0;
  const flush = async () => {
    if (chunk.length) text += (await sh(place, DIFF_UNTRACKED, chunk, opts)).stdout;
    chunk = [];
    sum = 0;
  };
  for (const { rel, size } of files) {
    if (chunk.length && (chunk.length >= UNTRACKED_CHUNK || sum + size > budget)) await flush();
    chunk.push(rel);
    sum += size;
  }
  await flush();
  return text;
}

// Prints a working-tree file that resolves inside the checkout and is a regular file; exit 3 otherwise.
// The trailing `.` keeps a name ending in a newline intact through command substitution.
const READ_FILE = `${CD}
r=$(pwd -P) || exit 3
f=$(realpath "./$1" 2>/dev/null && echo .); s=$?; [ "$s" -eq 0 ] || exit "$s"
f=\${f%.}; f=\${f%?}
case $f in "$r"/*) ;; *) exit 3 ;; esac
[ -f "$f" ] || exit 3
exec cat -- "$f"`;

/** Working-tree content of `rel`, or null when absent, unreadable or outside the checkout. Over MAX_DIFF_BYTES: DIFF_TOO_LARGE. */
export async function readWorktreeFile(place, rel) {
  try {
    return (await sh(place, READ_FILE, [rel])).stdout;
  } catch (e) {
    if (e instanceof Refusal || e.exitCode === 126 || e.exitCode === 127) throw e; // a missing tool fails loudly
    return null;
  }
}

/** Rename map for `from..to`: {newPath: oldPath}. */
export async function renames(place, from, to) {
  const r = await run(place, ['diff', '-M', '--name-status', '-z', from, to]);
  const parts = r.stdout.split('\0');
  const map = {};
  for (let i = 0; i < parts.length; i++) {
    const s = parts[i];
    if (s.startsWith('R')) { map[parts[i + 2]] = parts[i + 1]; i += 2; } else i += 1;
  }
  return map;
}

/** Commits, newest first. `range` is `a..b`; otherwise the last `limit` commits from HEAD. */
export async function commitLog(place, { range, limit = 50 } = {}) {
  const fmt = '--format=%H%x1f%h%x1f%an%x1f%aI%x1f%P%x1f%s%x1e';
  const args = range ? ['log', fmt, range] : ['log', fmt, '-n', String(limit), 'HEAD'];
  const r = await run(place, args, { ok: [0, 128] });
  return r.stdout.split('\x1e').map((s) => s.trim()).filter(Boolean).map((rec) => {
    const [sha, short, author, date, parents, subject] = rec.split('\x1f');
    return { sha, short, author, date, subject, merge: parents.split(' ').filter(Boolean).length > 1 };
  });
}

/** Current branch name, or 'HEAD' when detached. Works on an unborn branch. */
export async function currentBranch(place) {
  const r = await run(place, ['symbolic-ref', '-q', '--short', 'HEAD'], { ok: [0, 1] });
  return r.code === 0 ? r.stdout.trim() : 'HEAD';
}
