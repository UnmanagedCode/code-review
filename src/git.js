import { randomBytes } from 'node:crypto';
import { exec, EXEC_MAX_OUTPUT_BYTES } from './exec.js';
import { Refusal } from './refusals.js';

export const MAX_DIFF_BYTES = 64 * 1024 * 1024;
export const MAX_FILE_BYTES = 1024 * 1024;
export const MAX_UNTRACKED_FILES = 500;

// Pinned so user git config (external diff, textconv, prefixes, relative paths) cannot change the parsed shape.
export const DIFF_FLAGS = ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--no-relative', '--full-index', '-M', '--src-prefix=a/', '--dst-prefix=b/', '-U3'];

// GIT_OPTIONAL_LOCKS=0 stops `status` from refreshing .git/index, but `git diff <commit>` still rewrites it;
// working-tree diffs therefore run against a private index copy (see SCAN).
// An overlay on the target's own environment, on every call (scripts included).
const BASE_ENV = { LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0' };

// fsmonitor off on every call: with core.fsmonitor=true even `git status` starts a detached daemon that writes into .git.
// splitIndex off on every call: with core.splitIndex=true, writing the private index writes a new `sharedindex.*` into
// the real .git; off, git still reads an existing split index and writes the private one whole.
// (A clean/smudge filter named by the reviewed repo's own .gitattributes still runs on working-tree paths.)
const BASE_ARGS = ['-c', 'core.fsmonitor=false', '-c', 'core.splitIndex=false'];
const GIT = `git ${BASE_ARGS.join(' ')}`;

// Paths per batched script call, well under any ARG_MAX.
const SIZE_CHUNK = 200;
const UNTRACKED_CHUNK = 100;

const REF_RE = /^[A-Za-z0-9._\/@{}^~-]+$/;

/** Throws BAD_REF unless `x` is a plain ref/sha that cannot be read as an option. */
export function checkRef(x) {
  if (typeof x !== 'string' || !REF_RE.test(x) || x.startsWith('-')) throw new Refusal('BAD_REF', `not a valid ref: ${JSON.stringify(x)}`);
  return x;
}

/** Single-quotes `s` for a POSIX sh script. */
const shq = (s) => `'${s.replace(/'/g, `'\\''`)}'`;

// `bytes`: stdout stays a Buffer (scripts whose output is sliced by byte lengths).
async function call(place, argv, what, { input, ok = [0], maxBuffer = MAX_DIFF_BYTES, env, readOnly, bytes = false } = {}) {
  const r = await exec(place, argv, { env: { ...BASE_ENV, ...env }, stdin: input, maxOutputBytes: maxBuffer, readOnly });
  const stdout = bytes ? r.stdout : r.stdout.toString('utf8');
  if (ok.includes(r.code)) return { code: r.code, stdout };
  const stderr = r.stderr.toString('utf8');
  throw Object.assign(new Error(`${what} failed: ${stderr.trim() || `exit ${r.code}`}`), { exitCode: r.code, stderr });
}

/** Runs git in the checkout at `place`. Resolves {code, stdout}; exit codes outside `ok` throw an Error carrying stderr. */
export const run = (place, args, opts) => call(place, ['git', ...BASE_ARGS, '-C', place.path, ...args], `git ${args[0]}`, opts);

/** Runs a POSIX sh `script` on `place`'s system with `$1` = the checkout path and `args` after it. Same contract as `run`. */
export const sh = (place, script, args = [], opts) => call(place, ['sh', '-c', script, 'sh', place.path, ...args], 'sh script', opts);

// Only a command that writes nothing may use these: they let cc's transport failures be retried. `run` and `sh` never retry.
const read = (place, args, opts) => run(place, args, { ...opts, readOnly: true });
const readSh = (place, script, args, opts) => sh(place, script, args, { ...opts, readOnly: true });

const out = async (place, args, opts) => (await read(place, args, opts)).stdout.trim();

// C-quoted so a path with a newline, quote, backslash or leading '#' stays one entry (git unquotes entries starting with ").
const cQuote = (p) => `"${[...Buffer.from(p)].map((b) => {
  if (b === 0x22 || b === 0x5c) return `\\${String.fromCharCode(b)}`;
  return b < 0x20 || b >= 0x7f ? `\\${b.toString(8).padStart(3, '0')}` : String.fromCharCode(b);
}).join('')}"`;

// Exit code of a script that finds no checkout path: one sh never uses for its own errors (dash exits 2 on a syntax or
// arithmetic error, 126/127 on a command it cannot run, 128+ on a signal), so such a failure is never read as "gone".
const PATH_MISSING = 10;

// Every script enters the checkout first; `$1` is its path.
const CD = 'cd -- "$1" || exit 3; shift';

// The temp base: `${TMPDIR:-/tmp}` must be absolute, free of line terminators (before and after resolving), exist, and
// resolve outside both the checkout and its common git dir (exit 7 otherwise), checked before anything is created.
// Leaves `t` (the resolved base), `r` (the checkout, resolved), `i` and `o` (the absolute index and objects paths).
const NO_EOL = `case $t in *'\n'*|*'\r'*) exit 7 ;; esac`;
const TEMP_BASE = `t=\${TMPDIR:-/tmp}
case $t in /*) ;; *) exit 7 ;; esac
${NO_EOL}
t=$(cd -- "$t" && pwd -P) || exit 7
${NO_EOL}
r=$(pwd -P) || exit 3
c=$(${GIT} rev-parse --git-common-dir) || exit 4
c=$(cd -- "$c" && pwd -P) || exit 4
case $t/ in "$r"/*|"$c"/*) exit 7 ;; esac
i=$(${GIT} rev-parse --git-path index) || exit 4
o=$(${GIT} rev-parse --git-path objects) || exit 4
case $i in /*) ;; *) i=$PWD/$i ;; esac
case $o in /*) ;; *) o=$PWD/$o ;; esac`;

const DIFF = DIFF_FLAGS.map(shq).join(' ');

// First call of an uncommitted snapshot. $1 the checkout, $2 the private dir id, $3 the diff limit, $4 the output cap.
// Makes `<base>/cr-index-<id>` with a copy of the index carrying the original's exact times (`touch -r`, so git's
// racy-clean decisions on it are the original's own; a missing index is not copied), diffs the working tree against
// HEAD (or the empty tree) on that copy and lists untracked paths. Removes the dir on every failure after creating it.
// Prints "<dir>\0<objects>\0<head>\0<tracked bytes>\0<others bytes>\0", then the tracked diff and the `ls-files -z` list.
const SCAN = `[ -e "$1" ] || exit ${PATH_MISSING}
cd -- "$1" || exit 3
x=$2 max=$3 cap=$4
${TEMP_BASE}
h=$(${GIT} rev-parse --verify --quiet 'HEAD^{commit}') || h=$(${GIT} hash-object -t tree --stdin </dev/null) || exit 4
d=$t/cr-index-$x
mkdir -m 700 -- "$d" || exit 5
trap 'rm -rf -- "$d"' EXIT
mkdir -p "$d/objects/info" || exit 6
if [ -e "$i" ]; then { cp -- "$i" "$d/index" && touch -r "$i" "$d/index"; } || exit 6; fi
GIT_INDEX_FILE=$d/index; export GIT_INDEX_FILE
${GIT} ${DIFF} "$h" > "$d/tracked" || exit 8
${GIT} ls-files --others --exclude-standard -z > "$d/others" || exit 8
a=$(($(wc -c < "$d/tracked"))) && b=$(($(wc -c < "$d/others"))) || exit 8
[ "$a" -le "$max" ] && [ "$b" -le "$max" ] && [ $((a + b + 65536)) -le "$cap" ] || exit 9
trap - EXIT
printf '%s\\0%s\\0%s\\0%s\\0%s\\0' "$d" "$o" "$h" "$a" "$b"
cat -- "$d/tracked" "$d/others"`;

// Second and last call; removes the private dir however it ends. $1 the checkout, $2 the dir, $3 the C-quoted objects
// path (alternates entry, written only when restaging), $4 head, $5 the file size cap, $6 the untracked budget, $7 the
// diff limit, $8 the output cap, $9 the restage count R, then the untracked count U, R restage paths, U untracked paths,
// and prefetch items (`n<path>` working tree, `o<path>` at head). One meta line per argument, in order:
// restage `-` vanished, `O` over the cap, `F` git could not stage it, `S` staged (then the tracked diff is redone);
// untracked `-` vanished, `<size>` over the cap, `<size> D` deferred (once one is, all later ones are), `<size> d` diffed;
// prefetch `-` absent, `L` read it lazily, `<bytes>` its content follows.
// Prints "<meta bytes>\0<tracked>\0<untracked>\0<prefetch>\0", then the four parts.
const FINISH = `d=$2
trap 'rm -rf -- "$d"' EXIT
cd -- "$1" || exit 3
alt=$3 h=$4 max=$5 budget=$6 maxd=$7 cap=$8 n=$9
shift 9
u=$1; shift
r=$(pwd -P) || exit 3
GIT_INDEX_FILE=$d/index; export GIT_INDEX_FILE
: > "$d/meta" && : > "$d/tracked" && : > "$d/untracked" && : > "$d/pre" || exit 6
size() { s=$(ls -ldn -- "./$1" 2>/dev/null) || return 1; s=$(printf '%s\\n' "$s" | awk 'NR==1{print $5}'); case $s in ''|*[!0-9]*) s=0 ;; esac; }
if [ "$n" -gt 0 ]; then
  printf '%s\\n' "$alt" > "$d/objects/info/alternates" || exit 6
  GIT_OBJECT_DIRECTORY=$d/objects; export GIT_OBJECT_DIRECTORY
fi
staged=
while [ "$n" -gt 0 ]; do f=$1; shift; n=$((n - 1))
  if ! size "$f"; then echo -
  elif [ "$s" -gt "$max" ]; then echo O
  elif ${GIT} update-index --add -- "$f" 2>/dev/null; then echo S; staged=1
  else echo F; fi >> "$d/meta"
done
[ -z "$staged" ] || ${GIT} ${DIFF} "$h" > "$d/tracked" || exit 8
sum=0 defer=
while [ "$u" -gt 0 ]; do f=$1; shift; u=$((u - 1))
  if ! size "$f"; then echo -
  elif [ "$s" -gt "$max" ]; then echo "$s"
  elif [ -n "$defer" ] || { [ "$sum" -gt 0 ] && [ $((sum + s)) -gt "$budget" ]; }; then defer=1; echo "$s D"
  else ${GIT} ${DIFF} --no-index -- /dev/null "$f" >> "$d/untracked"; e=$?; [ "$e" -le 1 ] || exit 8; sum=$((sum + s)); echo "$s d"; fi >> "$d/meta"
done
pre=0
for a; do p=\${a#?}
  case $a in
  n*) f=$(realpath "./$p" 2>/dev/null && echo .); e=$?
      if [ "$e" -ge 126 ]; then echo L >> "$d/meta"; continue; fi
      f=\${f%.}; f=\${f%?}
      if [ "$e" -ne 0 ] || ! case $f in "$r"/*) true ;; *) false ;; esac || [ ! -f "$f" ]; then echo - >> "$d/meta"; continue; fi
      cat -- "$f" > "$d/one" || { echo L >> "$d/meta"; continue; } ;;
  o*) k=$(${GIT} cat-file -t "$h:$p" 2>/dev/null) || { echo - >> "$d/meta"; continue; }
      [ "$k" = blob ] || { echo L >> "$d/meta"; continue; }
      ${GIT} cat-file blob "$h:$p" > "$d/one" || { echo L >> "$d/meta"; continue; } ;;
  esac
  s=$(($(wc -c < "$d/one")))
  if [ "$s" -gt "$max" ] || [ $((pre + s)) -gt "$budget" ]; then echo L >> "$d/meta"; continue; fi
  cat -- "$d/one" >> "$d/pre" && pre=$((pre + s)) && echo "$s" >> "$d/meta" || exit 8
done
m=$(($(wc -c < "$d/meta"))) t2=$(($(wc -c < "$d/tracked"))) ud=$(($(wc -c < "$d/untracked")))
[ "$t2" -le "$maxd" ] && [ "$ud" -le "$maxd" ] && [ $((m + t2 + ud + pre + 256)) -le "$cap" ] || exit 9
printf '%s\\0%s\\0%s\\0%s\\0' "$m" "$t2" "$ud" "$pre"
cat -- "$d/meta" "$d/tracked" "$d/untracked" "$d/pre"`;

// Best-effort removal of `<base>/cr-index-<id>` ($2) when a SCAN's outcome is unknown (the exec itself failed).
const REMOVE_BY_ID = `t=\${TMPDIR:-/tmp}; case $t in /*) ;; *) exit 0 ;; esac
t=$(cd -- "$t" && pwd -P) || exit 0
rm -rf -- "$t/cr-index-$2"`;

const ID_RE = /^[0-9a-f]{24}$/;

/** Structurally a private index dir: absolute, no `..` segment, basename `cr-index-*`. Any byte else is allowed. */
const isTempDir = (d) => typeof d === 'string' && d.startsWith('/') && !d.split('/').includes('..')
  && d.slice(d.lastIndexOf('/') + 1).startsWith('cr-index-') && d.length > d.lastIndexOf('/') + 'cr-index-'.length + 1;

// What a scan or finish may print, given its diff limit: both diffs, the prefetch budget and headers.
const outputCap = (maxDiffBytes) => Math.min(2 * maxDiffBytes + 64 * 1024, EXEC_MAX_OUTPUT_BYTES);

const TEMP_TEXT = {
  5: (place) => `could not create a private index dir in TMPDIR on ${place.system}`,
  6: (place) => `could not prepare the private index in TMPDIR on ${place.system} (creating its objects dir or copying the index failed)`,
  7: (place) => `TMPDIR on ${place.system} is not an existing absolute directory outside the checkout and its git dir`,
};

/** `count` NUL-terminated byte lengths (or fields) off the front of `buf`: [fields, rest]. */
function header(buf, count) {
  const fields = [];
  let at = 0;
  for (let k = 0; k < count; k++) {
    const end = buf.indexOf(0, at);
    if (end < 0) throw new Error(`sh script printed a malformed header (${count} fields expected)`);
    fields.push(buf.subarray(at, end).toString('utf8'));
    at = end + 1;
  }
  return [fields, buf.subarray(at)];
}

/** Splits `buf` into parts of the given byte lengths; they must cover it exactly. */
function parts(buf, lengths) {
  const out = [];
  let at = 0;
  for (const n of lengths.map(Number)) {
    out.push(buf.subarray(at, at + n));
    at += n;
  }
  if (at !== buf.length) throw new Error(`sh script printed ${buf.length} bytes after its header, ${at} announced`);
  return out;
}

async function removeById(place, id) {
  await sh(place, REMOVE_BY_ID, [id]).catch((e) => {
    console.warn(`code-review: could not remove the private index dir cr-index-${id} on ${place.system}: ${e.message}`);
  });
}

const warnLeak = (place, dir) => (e) => {
  console.warn(`code-review: could not remove the private index dir ${dir} on ${place.system}: ${e.message}`);
};

/**
 * First of the two calls of an uncommitted snapshot: the tracked diff on a private index copy and the untracked list.
 * Resolves {dir, objects, head, tracked (diff text), others (paths)}; the private dir is left for `finishWorktree`.
 * A missing checkout is CHECKOUT_GONE; a bad TMPDIR TEMP_UNUSABLE; output over the limit DIFF_TOO_LARGE.
 */
export async function scanWorktree(place, { maxDiffBytes }) {
  const id = randomBytes(12).toString('hex');
  if (!ID_RE.test(id)) throw new Error(`bad private dir id ${id}`);
  const cap = outputCap(maxDiffBytes);
  let r;
  try {
    r = await call(place, ['sh', '-c', SCAN, 'sh', place.path, id, String(maxDiffBytes), String(cap)], 'sh script',
      { ok: [0, PATH_MISSING, 5, 6, 7, 9], maxBuffer: cap, bytes: true });
  } catch (e) {
    // 3, 4 and 8 end before the dir exists or with the trap removing it; anything else (the exec failed, an unknown
    // exit) leaves the dir's fate unknown, so it is removed by id.
    if (e instanceof Refusal || ![3, 4, 8].includes(e.exitCode)) await removeById(place, id);
    throw e;
  }
  if (r.code === PATH_MISSING) throw new Refusal('CHECKOUT_GONE', `${place.path} no longer exists`);
  if (TEMP_TEXT[r.code]) throw new Refusal('TEMP_UNUSABLE', TEMP_TEXT[r.code](place));
  if (r.code === 9) throw new Refusal('DIFF_TOO_LARGE', 'output exceeds the size limit');
  const [[dir, objects, head, a, b], rest] = header(r.stdout, 5);
  // The script prints `<base>/cr-index-<id>`; anything else names no dir it made.
  if (!isTempDir(dir) || dir.slice(dir.lastIndexOf('/') + 1) !== `cr-index-${id}`) {
    await removeById(place, id);
    throw new Refusal('TEMP_UNUSABLE', `private index: the scan script printed no private index dir (${JSON.stringify(dir)})`);
  }
  const [tracked, others] = parts(rest, [a, b]);
  return {
    dir, objects, head, tracked: tracked.toString('utf8'),
    others: others.toString('utf8').split('\0').filter((p) => p && !p.endsWith('/')),
  };
}

/**
 * Second call: restages `restage`, diffs `untracked` (in order, within the budget) and reads `prefetch` ([{side, path}]),
 * then removes the private dir. Resolves {restage: [meta], untracked: [meta], prefetch: [null | 'lazy' | content],
 * tracked (the redone diff, '' when nothing was staged), untrackedDiff}.
 */
export async function finishWorktree(place, { dir, objects, head, maxFileBytes, maxDiffBytes, restage, untracked, prefetch }) {
  const cap = outputCap(maxDiffBytes);
  const items = prefetch.map(({ side, path }) => `${side === 'old' ? 'o' : 'n'}${path}`);
  const args = [dir, cQuote(objects), head, String(maxFileBytes), String(Math.floor(maxDiffBytes / 3)), String(maxDiffBytes), String(cap),
    String(restage.length), String(untracked.length), ...restage, ...untracked, ...items];
  let r;
  try {
    r = await call(place, ['sh', '-c', FINISH, 'sh', place.path, ...args], 'sh script', { ok: [0, 6, 9], maxBuffer: cap, bytes: true });
  } catch (e) {
    await removeTemp(place, dir).catch(warnLeak(place, dir));
    throw e;
  }
  if (r.code !== 0) {
    await removeTemp(place, dir).catch(warnLeak(place, dir));
    if (r.code === 6) throw new Refusal('TEMP_UNUSABLE', TEMP_TEXT[6](place));
    throw new Refusal('DIFF_TOO_LARGE', 'output exceeds the size limit');
  }
  const [lengths, rest] = header(r.stdout, 4);
  const [meta, tracked, untrackedDiff, pre] = parts(rest, lengths);
  const lines = meta.toString('utf8').split('\n').slice(0, -1);
  if (lines.length !== restage.length + untracked.length + items.length) {
    throw new Error(`sh script answered ${lines.length} meta lines for ${restage.length + untracked.length + items.length} arguments`);
  }
  let at = 0;
  const read = lines.slice(restage.length + untracked.length).map((l) => {
    if (l === '-') return null;
    if (l === 'L') return 'lazy';
    const n = Number(l);
    const content = pre.subarray(at, at + n).toString('utf8');
    at += n;
    return { content };
  });
  return {
    restage: lines.slice(0, restage.length), untracked: lines.slice(restage.length, restage.length + untracked.length),
    prefetch: read, tracked: tracked.toString('utf8'), untrackedDiff: untrackedDiff.toString('utf8'),
  };
}

/** Removes a private index dir; refuses any path not named `cr-index-*`. */
export async function removeTemp(place, dir) {
  if (!isTempDir(dir)) throw new Error(`refusing to remove ${JSON.stringify(dir)}: not a private index dir`);
  await call(place, ['rm', '-rf', '--', dir], 'rm');
}

/** True when `place.path` exists on its system (symlinks followed). */
export async function exists(place) {
  return (await call(place, ['sh', '-c', '[ -e "$1" ]', 'sh', place.path], 'exists', { ok: [0, 1], readOnly: true })).code === 0;
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
  const r = await read(place, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], { ok: [0, 1] });
  return r.code === 0 ? r.stdout.trim() : null;
}

export const emptyTree = (place) => out(place, ['hash-object', '-t', 'tree', '--stdin']);

/** Merge base of two commits, or null when unrelated. */
export async function mergeBase(place, a, b) {
  const r = await read(place, ['merge-base', a, b], { ok: [0, 1] });
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
  return (await readSh(place, OBJECTS_EXIST, [...new Set(shas)])).stdout.trim() || null;
}

/** File content at `sha:path`, or null when absent. */
export async function show(place, sha, path) {
  const r = await read(place, ['show', `${sha}:${path}`], { ok: [0, 128] });
  return r.code === 0 ? r.stdout : null;
}

const STATUS_ARGS = ['status', '--porcelain=v2', '-z', '--branch', '--no-ahead-behind', '--untracked-files=normal'];

/** {head, branch, dirty} from `git status --porcelain=v2 -z --branch` output: head null on an unborn branch, branch 'HEAD' when detached. */
function parseStatus(text) {
  let head = null;
  let branch = 'HEAD';
  let dirty = false;
  for (const rec of text.split('\0')) {
    if (rec.startsWith('# branch.oid ')) { const v = rec.slice(13); head = v === '(initial)' ? null : v; }
    else if (rec.startsWith('# branch.head ')) { const v = rec.slice(14); branch = v === '(detached)' ? 'HEAD' : v; }
    else if (rec && !rec.startsWith('# ')) dirty = true;
  }
  return { head, branch, dirty };
}

/** {head, branch, dirty} from one `git status`. */
export const statusOf = async (place) => parseStatus((await read(place, STATUS_ARGS)).stdout);

// Read-only. $1 the checkout, $2 the main checkout (either may be ''), $3 '1' for status, then shas. Enters the first
// that exists (exit PATH_MISSING: neither), prints "<checkout|main>\0<first sha missing from the object store, or nothing>\0",
// then, when asked and in the checkout, the status records.
const PROBE = `if [ -n "$1" ] && [ -e "$1" ]; then w=checkout; cd -- "$1" || exit 3
elif [ -n "$2" ] && [ -e "$2" ]; then w=main; cd -- "$2" || exit 3
else exit ${PATH_MISSING}; fi
st=$3; shift 3
m=
for s; do ${GIT} cat-file -e "$s^{tree}" 2>/dev/null || { m=$s; break; }; done
printf '%s\\0%s\\0' "$w" "$m"
[ "$st" = 1 ] && [ "$w" = checkout ] || exit 0
${GIT} ${STATUS_ARGS.join(' ')} || exit 8`;

/**
 * One call on `place`'s system: where a checkout is (`path`, else `mainPath`; '' = none), the first of `shas` missing
 * from that repo's object store, and (`status`, in the checkout only) its {head, branch, dirty}.
 * Resolves {where: 'checkout'|'main'|null, missing: sha|null, status: {head, branch, dirty}|null}.
 */
export async function probe(place, { path, mainPath = '', status = false, shas = [] }) {
  const r = await call(place, ['sh', '-c', PROBE, 'sh', path ?? '', mainPath ?? '', status ? '1' : '0', ...new Set(shas)], 'sh script', { ok: [0, PATH_MISSING], readOnly: true });
  if (r.code === PATH_MISSING) return { where: null, missing: null, status: null };
  const [where, missing] = r.stdout.split('\0', 2);
  const rest = r.stdout.slice(where.length + missing.length + 2);
  return { where, missing: missing || null, status: status && where === 'checkout' ? parseStatus(rest) : null };
}

/** Raw unified diff between two trees/commits. */
export const diffBetween = (place, from, to, opts) => read(place, [...DIFF_FLAGS, from, to], opts).then((r) => r.stdout);

// One line per argument: its lstat size (`ls -ldn` reports a symlink itself), or `-` when it does not exist.
// Names are never echoed, so a newline in one cannot shift the lines.
const SIZES = `${CD}
for f; do s=$(ls -ldn -- "./$f" 2>/dev/null) && printf '%s\\n' "$s" | awk 'NR==1{print $5}' || echo -; done`;

/** lstat size of each relative path (null = absent; a device = 0), in argument order. */
export async function sizes(place, rels) {
  const res = [];
  for (let i = 0; i < rels.length; i += SIZE_CHUNK) {
    const chunk = rels.slice(i, i + SIZE_CHUNK);
    const got = (await readSh(place, SIZES, chunk)).stdout.split('\n').slice(0, -1);
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
    if (chunk.length) text += (await readSh(place, DIFF_UNTRACKED, chunk, opts)).stdout;
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
    return (await readSh(place, READ_FILE, [rel])).stdout;
  } catch (e) {
    if (e instanceof Refusal || e.exitCode === 126 || e.exitCode === 127) throw e; // a missing tool fails loudly
    return null;
  }
}

/** Rename map for `from..to`: {newPath: oldPath}. */
export async function renames(place, from, to) {
  const r = await read(place, ['diff', '-M', '--name-status', '-z', from, to]);
  const parts = r.stdout.split('\0');
  const map = {};
  for (let i = 0; i < parts.length; i++) {
    const s = parts[i];
    if (s.startsWith('R')) { map[parts[i + 2]] = parts[i + 1]; i += 2; } else i += 1;
  }
  return map;
}

// One commit record per `\x1e`, its fields split by `\x1f`; read by parseLog.
const LOG_FORMAT = '--format=%H%x1f%h%x1f%an%x1f%aI%x1f%P%x1f%s%x1e';
const parseLog = (stdout) => stdout.split('\x1e').map((s) => s.trim()).filter(Boolean).map((rec) => {
  const [sha, short, author, date, parents, subject] = rec.split('\x1f');
  return { sha, short, author, date, subject, merge: parents.split(' ').filter(Boolean).length > 1 };
});

/** Commits, newest first. `range` is `a..b`; otherwise the last `limit` commits from HEAD. */
export async function commitLog(place, { range, limit = 50 } = {}) {
  const args = range ? ['log', LOG_FORMAT, range] : ['log', LOG_FORMAT, '-n', String(limit), 'HEAD'];
  const r = await read(place, args, { ok: [0, 128] });
  return parseLog(r.stdout);
}

/** The record of one commit (a full sha, already resolved), shaped as a `commitLog` row. */
export async function commitOf(place, sha) {
  return parseLog((await read(place, ['log', LOG_FORMAT, '-n', '1', sha])).stdout)[0];
}

/** Current branch name, or 'HEAD' when detached. Works on an unborn branch. */
export async function currentBranch(place) {
  const r = await read(place, ['symbolic-ref', '-q', '--short', 'HEAD'], { ok: [0, 1] });
  return r.code === 0 ? r.stdout.trim() : 'HEAD';
}
