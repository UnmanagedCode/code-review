import { createHash } from 'node:crypto';
import { parseDiff, fileLevelHunk } from './diff.js';
import { Refusal } from './refusals.js';
import { placeKey } from './exec.js';
import * as git from './git.js';

const CACHE_MAX = 32;
const cache = new Map(); // committed snapshots are immutable: `${placeKey(repo)}\0${base}\0${head}` -> {files, fingerprint}

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

/** Resolves a review target to the two shas of a round: {headSha, baseSha}. */
export async function resolveTarget(repo, kind, target = {}) {
  if (kind === 'uncommitted') {
    const headSha = (await git.headOf(repo)) ?? (await git.emptyTree(repo));
    return { headSha, baseSha: headSha };
  }
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

const uncommittedDiff = (repo, headSha, limits) =>
  git.withPrivateIndex(repo, ({ env }) => readUncommitted(repo, headSha, limits, { env, maxBuffer: limits.maxDiffBytes }));

async function readUncommitted(repo, headSha, limits, opts) {
  let files = parseDiff(await git.diffWorktree(repo, headSha, opts));
  let rels = await git.untracked(repo, opts);
  // A path HEAD has but the index lacks (`git rm --cached`) shows up deleted above and untracked below.
  // Staging it into the private index makes `diff HEAD` report the working tree against HEAD, once.
  const restage = files.filter((f) => f.status === 'deleted' && rels.includes(f.path)).map((f) => f.path);
  const survivors = [];
  const oversize = [];
  rels = rels.filter((p) => !restage.includes(p));
  for (const [i, size] of (await git.sizes(repo, restage)).entries()) {
    if (size === null) continue; // vanished: it stays deleted
    if (size > limits.maxFileBytes) oversize.push(restage[i]);
    else survivors.push(restage[i]);
  }
  let staged = survivors;
  if (survivors.length) {
    try {
      await git.addToIndex(repo, survivors, opts);
    } catch (e) {
      if (e instanceof Refusal) throw e;
      staged = []; // one unreadable path (e.g. a failing required filter) fails the batch: stage one by one
      for (const rel of survivors) {
        try { await git.addToIndex(repo, [rel], opts); staged.push(rel); } catch (e2) {
          if (e2 instanceof Refusal) throw e2;
          oversize.push(rel); // unreadable: listed, not diffed
        }
      }
    }
  }
  if (staged.length) files = parseDiff(await git.diffWorktree(repo, headSha, opts));
  files = files.filter((f) => !oversize.includes(f.path));
  // Past the count cap a path is tooLarge whatever its size, so only the first `maxUntracked` are measured.
  const measured = await git.sizes(repo, rels.slice(0, limits.maxUntracked));
  const shown = [];
  const extra = [];
  for (const [i, rel] of rels.entries()) {
    const size = measured[i] ?? Infinity; // vanished mid-read: treat as too large to show
    if (i >= limits.maxUntracked || size > limits.maxFileBytes) extra.push(tooLargeFile(rel));
    else shown.push({ rel, size });
  }
  const text = await git.diffUntrackedBatch(repo, shown, opts);
  files.push(...parseDiff(text), ...extra, ...oversize.map((rel) => tooLargeFile(rel, 'modified')));
  return files;
}

/** The refusal for a round whose commit is no longer in the object store. */
export const snapshotGone = (sha) => new Refusal('SNAPSHOT_GONE', `commit ${sha.slice(0, 8)} is no longer in the repository`);

/**
 * Builds the snapshot for one round: {files, fingerprint, baseSha, headSha, lines(side, path)}.
 * `repo` (a place) supplies git objects; `checkout` (a place) supplies the working tree (uncommitted only).
 * `verified`: the caller already found both shas in `repo`'s object store.
 */
export async function buildSnapshot({ kind, repo, checkout, baseSha, headSha, verified = false, limits: given = {} }) {
  const limits = { maxFileBytes: git.MAX_FILE_BYTES, maxUntracked: git.MAX_UNTRACKED_FILES, maxDiffBytes: git.MAX_DIFF_BYTES, ...given };
  const missing = verified ? null : await git.objectsExist(repo, [baseSha, headSha]);
  if (missing) throw snapshotGone(missing);
  const key = `${placeKey(repo)}\0${baseSha}\0${headSha}\0${kind}`;
  let entry = kind !== 'uncommitted' && cache.get(key);
  if (entry) entry = structuredClone(entry);
  else {
    let files;
    let text = '';
    if (kind === 'uncommitted') files = await uncommittedDiff(repo, headSha, limits);
    else {
      text = await git.diffBetween(repo, baseSha, headSha, { maxBuffer: limits.maxDiffBytes });
      files = parseDiff(text);
    }
    entry = { files, fingerprint: createHash('sha256').update(headSha).update(JSON.stringify(files)).digest('hex') };
    if (kind !== 'uncommitted') {
      cache.set(key, structuredClone(entry));
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    }
  }
  const { files, fingerprint } = entry;

  /** Lines of `rel` on one side, or null when the file is absent there. `rel` is the file's current path. */
  async function lines(side, rel) {
    const f = files.find((x) => x.path === rel);
    let content;
    if (side === 'old') content = await git.show(repo, baseSha, f?.oldPath ?? rel);
    else content = kind === 'uncommitted' ? await git.readWorktreeFile(checkout, rel) : await git.show(repo, headSha, rel);
    return content === null ? null : splitLines(content);
  }

  return { files, fingerprint, baseSha, headSha, lines };
}
