/** Rows of a list or the inbox resolved at once per request: at most two exec calls each, so a request keeps a handful in flight. */
export const ROW_CONCURRENCY = 4;

/** `fn` over `items` with at most `limit` calls pending; results in input order. The first rejection rejects, and no further item starts. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const i = next++;
      try { out[i] = await fn(items[i], i); } catch (e) { failed = true; throw e; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
