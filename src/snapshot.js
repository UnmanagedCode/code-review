import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseDiff, fileLevelHunk } from './diff.js';
import { Refusal } from './refusals.js';
import * as git from './git.js';

const CACHE_MAX = 32;
const cache = new Map(); // committed snapshots are immutable: `${repo}\0${base}\0${head}` -> {files, fingerprint}

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
  for (const rel of restage) {
    rels = rels.filter((p) => p !== rel);
    let size;
    try { size = fs.lstatSync(path.join(repo, rel)).size; } catch { continue; } // vanished: it stays deleted
    if (size > limits.maxFileBytes) oversize.push(rel);
    else survivors.push(rel);
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
  let text = '';
  const extra = [];
  for (const [i, rel] of rels.entries()) {
    let size = Infinity;
    try { size = fs.lstatSync(path.join(repo, rel)).size; } catch { /* vanished mid-read: treat as too large to show */ }
    if (i >= limits.maxUntracked || size > limits.maxFileBytes) extra.push(tooLargeFile(rel));
    else text += await git.diffUntracked(repo, rel, opts);
  }
  files.push(...parseDiff(text), ...extra, ...oversize.map((rel) => tooLargeFile(rel, 'modified')));
  return files;
}

/**
 * Builds the snapshot for one round: {files, fingerprint, lines(side, path)}.
 * `repo` supplies git objects; `checkout` supplies the working tree (uncommitted only).
 */
export async function buildSnapshot({ kind, repo, checkout, baseSha, headSha, limits: given = {} }) {
  const limits = { maxFileBytes: git.MAX_FILE_BYTES, maxUntracked: git.MAX_UNTRACKED_FILES, maxDiffBytes: git.MAX_DIFF_BYTES, ...given };
  for (const sha of [baseSha, headSha]) {
    if (!(await git.objectExists(repo, sha))) throw new Refusal('SNAPSHOT_GONE', `commit ${sha.slice(0, 8)} is no longer in the repository`);
  }
  const key = `${repo}\0${baseSha}\0${headSha}\0${kind}`;
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

  async function readLive(rel) {
    try {
      const root = fs.realpathSync(checkout);
      const real = fs.realpathSync(path.join(checkout, rel));
      if (!real.startsWith(root + path.sep)) return null;
      return fs.readFileSync(real, 'utf8');
    } catch { return null; }
  }

  /** Lines of `rel` on one side, or null when the file is absent there. `rel` is the file's current path. */
  async function lines(side, rel) {
    const f = files.find((x) => x.path === rel);
    let content;
    if (side === 'old') content = await git.show(repo, baseSha, f?.oldPath ?? rel);
    else content = kind === 'uncommitted' ? await readLive(rel) : await git.show(repo, headSha, rel);
    return content === null ? null : splitLines(content);
  }

  return { files, fingerprint, lines };
}
