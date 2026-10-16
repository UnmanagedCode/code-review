import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { storeRoot } from './paths.js';
import { withLock } from './mutex.js';
import { refuse, isRefusal } from './refusals.js';

/** Emits 'change' with {id, rev} after a write or {id, deleted:true} after a remove. */
export const changes = new EventEmitter();
changes.setMaxListeners(0); // one listener per open SSE client, removed on disconnect

const ID_RE = /^r-[0-9a-f]{10}$/;
const dirOf = () => path.join(storeRoot(), 'reviews');
const fileOf = (id) => path.join(dirOf(), `${id}.json`);

export const newId = () => `r-${randomBytes(5).toString('hex')}`;

/** The review, or null when absent or when `id` is not store-shaped. */
export function read(id) {
  if (!ID_RE.test(id)) return null;
  try {
    return JSON.parse(fs.readFileSync(fileOf(id), 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
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

export function list() {
  let names;
  try { names = fs.readdirSync(dirOf()); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  return names.filter((n) => n.endsWith('.json')).map((n) => read(n.slice(0, -5))).filter(Boolean);
}

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
