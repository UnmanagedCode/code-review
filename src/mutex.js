// Per-key promise chain: callbacks sharing a key never interleave, so the file
// store is race-free without file locking. Keys live for the process lifetime.
const tails = new Map();

export function withLock(key, fn) {
  const prev = tails.get(key) ?? Promise.resolve();
  const result = prev.then(fn, fn);
  tails.set(key, result.then(() => {}, () => {}));
  return result;
}
