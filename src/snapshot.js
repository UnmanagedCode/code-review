import { createHash } from 'node:crypto';
import { parseDiff, fileLevelHunk } from './diff.js';
import { Refusal } from './refusals.js';
import { placeKey } from './exec.js';
import * as git from './git.js';

const CACHE_MAX = 32;
const cache = new Map(); // committed snapshots are immutable: `${placeKey(repo)}\0${base}\0${head}\0${kind}` -> {files, fingerprint}

/** Splits file content into lines; a trailing newline does not add an empty line. */
export function splitLines(content) {
  const lines = content.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Whether `path` must not be shown as text: the diff's own verdict when the file is in it (git honours
 * .gitattributes and caps), a NUL scan of its content otherwise. `readLines` is called only for the scan, so a
 * flagged file is refused without being read; a missing file (null) is not binary.
 */
export async function isBinaryFile(snap, path, readLines) {
  const f = snap.files?.find((x) => x.path === path);
  if (f) return Boolean(f.binary || f.tooLarge);
  return ((await readLines()) ?? []).some((l) => l.includes('\0'));
}

/** Resolves a range or commit target to the two shas of a round: {headSha, baseSha}. Uncommitted shas come from the snapshot. */
export async function resolveTarget(repo, kind, target = {}) {
  const ref = kind === 'range' ? target.base : (target.sha ?? 'HEAD');
  git.checkRef(ref);
  const head = await git.headOf(repo);
  if (!head) throw new Refusal('UNBORN_HEAD', 'the checkout has no commits');
  if (kind === 'commit') {
    const headSha = await git.resolveCommit(repo, ref);
    return { headSha, baseSha: (await git.parentOf(repo, headSha)) ?? (await git.emptyTree(repo)) };
  }
  const base = await git.resolveCommit(repo, ref);
  const baseSha = await git.mergeBase(repo, base, head);
  if (!baseSha) throw new Refusal('NO_COMMON_ANCESTOR', `${ref} shares no history with HEAD`);
  return { headSha: head, baseSha };
}

const tooLargeFile = (rel, status = 'added') => {
  const f = { path: rel, oldPath: null, status, binary: false, tooLarge: true, additions: 0, deletions: 0, hunks: [] };
  f.hunks.push(fileLevelHunk(f));
  return f;
};

/** Untracked path bytes passed to the finishing call; the rest (rare) are measured and diffed by the batched helpers. */
export const ARGV_BUDGET = 256 * 1024;

/**
 * The working tree against HEAD in two exec calls (scan, then finish), one entry per path: {files, head, prefetched}.
 * `prefetch` ([{side, file}], thread anchors) names lines read in the finishing call; `prefetched` maps
 * `${side}\0${read path}` to null (absent), 'lazy' or {content}.
 */
async function uncommittedDiff(checkout, limits, prefetch) {
  const scan = await git.scanWorktree(checkout, { maxDiffBytes: limits.maxDiffBytes });
  let files = parseDiff(scan.tracked);
  const others = new Set(scan.others);
  // A path HEAD has but the index lacks (`git rm --cached`) shows up deleted and untracked.
  // Staging it into the private index makes `diff HEAD` report the working tree against HEAD, once.
  const restage = files.filter((f) => f.status === 'deleted' && others.has(f.path)).map((f) => f.path);
  const restaged = new Set(restage);
  const rels = scan.others.filter((p) => !restaged.has(p));
  // Past the count cap a path is tooLarge whatever its size, so only the first `maxUntracked` are measured.
  const counted = rels.slice(0, limits.maxUntracked);
  let passed = 0;
  for (let bytes = 0; passed < counted.length; passed++) {
    bytes += Buffer.byteLength(counted[passed]) + 1;
    if (bytes > ARGV_BUDGET) break;
  }
  const inDiff = new Map(files.map((f) => [f.path, f]));
  const reads = new Map();
  for (const { side, file } of prefetch) {
    if (side === 'old' ? !inDiff.has(file) : !inDiff.has(file) && !others.has(file)) continue;
    const at = side === 'old' ? (inDiff.get(file).oldPath ?? file) : file;
    reads.set(`${side}\0${at}`, { side, path: at });
  }
  const done = await git.finishWorktree(checkout, {
    dir: scan.dir, objects: scan.objects, head: scan.head, maxFileBytes: limits.maxFileBytes, maxDiffBytes: limits.maxDiffBytes,
    restage, untracked: counted.slice(0, passed), prefetch: [...reads.values()],
  });
  // Over the cap (O) or unreadable to git (F): listed, not diffed. Vanished (-): it stays deleted.
  const oversize = restage.filter((_, i) => done.restage[i] === 'O' || done.restage[i] === 'F');
  if (done.restage.includes('S')) files = parseDiff(done.tracked);
  files = files.filter((f) => !oversize.includes(f.path));
  const overflow = counted.slice(passed);
  const overflowSizes = overflow.length ? await git.sizes(checkout, overflow) : [];
  const deferred = [];
  const extra = [];
  for (const [i, rel] of rels.entries()) {
    if (i >= limits.maxUntracked) extra.push(tooLargeFile(rel));
    else if (i < passed) {
      const [size, how] = done.untracked[i].split(' ');
      if (how === 'D') deferred.push({ rel, size: Number(size) });
      else if (how !== 'd') extra.push(tooLargeFile(rel)); // vanished, or over the size cap
    } else {
      const size = overflowSizes[i - passed] ?? Infinity; // vanished mid-read: treat as too large to show
      if (size > limits.maxFileBytes) extra.push(tooLargeFile(rel));
      else deferred.push({ rel, size });
    }
  }
  let text = done.untrackedDiff;
  if (deferred.length) text += await git.diffUntrackedBatch(checkout, deferred, { maxBuffer: limits.maxDiffBytes });
  files.push(...parseDiff(text), ...extra, ...oversize.map((rel) => tooLargeFile(rel, 'modified')));
  const prefetched = new Map([...reads.keys()].map((k, i) => [k, done.prefetch[i]]));
  return { files, head: scan.head, prefetched };
}

/** The refusal for a round whose commit is no longer in the object store. */
export const snapshotGone = (sha) => new Refusal('SNAPSHOT_GONE', `commit ${sha.slice(0, 8)} is no longer in the repository`);

/**
 * Builds the snapshot for one round: {files, fingerprint, baseSha, headSha, lines(side, path)}.
 * Range and commit: `repo` (a place) supplies git objects for the given shas; `verified`: the caller already found both
 * in its object store. Uncommitted: `checkout` (a place) supplies the working tree and HEAD (both shas), in two exec
 * calls; `prefetch` ([{side, file}]) names the lines read in the second one.
 */
export async function buildSnapshot({ kind, repo, checkout, baseSha, headSha, verified = false, prefetch = [], limits: given = {} }) {
  const limits = { maxFileBytes: git.MAX_FILE_BYTES, maxUntracked: git.MAX_UNTRACKED_FILES, maxDiffBytes: git.MAX_DIFF_BYTES, ...given };
  if (kind === 'uncommitted') {
    const { files, head, prefetched } = await uncommittedDiff(checkout, limits, prefetch);
    const fingerprint = createHash('sha256').update(head).update(JSON.stringify(files)).digest('hex');
    return withLines({ kind, repo: checkout, checkout, baseSha: head, headSha: head, files, fingerprint, prefetched });
  }
  const missing = verified ? null : await git.objectsExist(repo, [baseSha, headSha]);
  if (missing) throw snapshotGone(missing);
  const key = `${placeKey(repo)}\0${baseSha}\0${headSha}\0${kind}`;
  let entry = cache.get(key);
  if (entry) entry = structuredClone(entry);
  else {
    const files = parseDiff(await git.diffBetween(repo, baseSha, headSha, { maxBuffer: limits.maxDiffBytes }));
    entry = { files, fingerprint: createHash('sha256').update(headSha).update(JSON.stringify(files)).digest('hex') };
    cache.set(key, structuredClone(entry));
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  }
  return withLines({ kind, repo, checkout, baseSha, headSha, ...entry, prefetched: new Map() });
}

// The snapshot object: `lines(side, rel)` serves prefetched content, else reads it.
function withLines({ kind, repo, checkout, baseSha, headSha, files, fingerprint, prefetched }) {
  /** Lines of `rel` on one side, or null when the file is absent there. `rel` is the file's current path. */
  async function lines(side, rel) {
    const f = files.find((x) => x.path === rel);
    const at = side === 'old' ? (f?.oldPath ?? rel) : rel;
    const got = prefetched.get(`${side}\0${at}`);
    let content;
    if (got !== undefined && got !== 'lazy') content = got?.content ?? null;
    else if (side === 'old') content = await git.show(repo, baseSha, at);
    else content = kind === 'uncommitted' ? await git.readWorktreeFile(checkout, rel) : await git.show(repo, headSha, rel);
    return content === null ? null : splitLines(content);
  }

  return { files, fingerprint, baseSha, headSha, lines };
}
