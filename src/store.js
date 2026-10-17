import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { storeRoot } from './paths.js';
import { withLock } from './mutex.js';
import { refuse, isRefusal } from './refusals.js';
import { clean } from './text.js';

/** Emits 'change' with {id, rev} after a write or {id, deleted:true} after a remove. */
export const changes = new EventEmitter();
changes.setMaxListeners(0); // one listener per open SSE client, removed on disconnect

const ID_RE = /^r-[0-9a-f]{10}$/;
const dirOf = () => path.join(storeRoot(), 'reviews');
const fileOf = (id) => path.join(dirOf(), `${id}.json`);

export const newId = () => `r-${randomBytes(5).toString('hex')}`;

/**
 * A review file whose content names another review (a copy restored under a new name, a symlink into another store).
 * It is never read as either review, so nothing is ever written from it: `write` persists under the content's id.
 */
export class MisfiledReview extends Error {
  constructor(id, inner) {
    super(`${id}.json holds review ${typeof inner === 'string' ? inner : 'with no id'}`);
    this.name = 'MisfiledReview';
  }
}

/** The review, or null when absent or when `id` is not store-shaped. Throws on unparsable JSON and on `MisfiledReview`. */
export function read(id) {
  if (!ID_RE.test(id)) return null;
  let review;
  try {
    review = JSON.parse(fs.readFileSync(fileOf(id), 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  if (review?.id !== id) throw new MisfiledReview(id, review?.id);
  return review;
}

/**
 * Logs a review file left aside, on one line: the error's name and its message with whitespace collapsed and control
 * characters removed (a parse error quotes the file's own bytes, which must not forge log lines).
 */
export function logSkipped(id, what, e) {
  console.error(`code-review: review ${id} ${what}: ${e.name}: ${clean(String(e.message).replace(/\s+/g, ' '))}`);
}

/** Atomically writes `review` (tmp file + rename), bumping `rev`. */
export function write(review) {
  review.rev = (review.rev ?? 0) + 1;
  fs.mkdirSync(dirOf(), { recursive: true });
  const tmp = path.join(dirOf(), `.${review.id}.${randomBytes(4).toString('hex')}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(review, null, 2));
  fs.renameSync(tmp, fileOf(review.id));
  changes.emit('change', { id: review.id, rev: review.rev });
}

/** Ids of the stored reviews, from file names only (no file is parsed). */
export function ids() {
  let names;
  try { names = fs.readdirSync(dirOf()); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  return names.filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5)).filter((id) => ID_RE.test(id));
}

/** Every readable review; a file that cannot be read as its review is logged and skipped, so one bad file hides only itself. */
export const list = () => ids().flatMap((id) => {
  try {
    const review = read(id);
    return review ? [review] : [];
  } catch (e) {
    logSkipped(id, 'skipped', e);
    return [];
  }
});

export function remove(id) {
  if (!ID_RE.test(id)) return;
  fs.rmSync(fileOf(id), { force: true });
  changes.emit('change', { id, deleted: true });
}

/**
 * Runs `fn(review)` under the review's lock and persists the review if `fn` changed it.
 * A refusal returned by `fn` aborts without writing; `fn`'s return value is passed through.
 */
export function mutate(id, fn) {
  return withLock(id, async () => {
    const review = read(id);
    if (!review) return refuse('REVIEW_UNKNOWN', `unknown review: ${id}`);
    const before = JSON.stringify(review);
    const res = await fn(review);
    if (isRefusal(res)) return res;
    if (JSON.stringify(review) !== before) write(review);
    return res;
  });
}
