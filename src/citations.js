// `path#L10-L20` references inside message bodies. Paths are relative to the checkout root.
const CITATION_RE = /(?<![\w\/.:-])((?:[\w.-]+\/)*[\w.-]+\.?[\w-]*)#L(\d+)(?:-L(\d+))?/g;

export const MAX_EXCERPT_LINES = 80;

/** [{raw, path, startLine, endLine}] for every citation in `body`. */
export function parseCitations(body) {
  return [...String(body ?? '').matchAll(CITATION_RE)].map((m) => {
    const a = Number(m[2]);
    const b = m[3] === undefined ? a : Number(m[3]);
    return { raw: m[0], path: m[1], startLine: Math.min(a, b), endLine: Math.max(a, b) };
  });
}

const unsafe = (p) => p.startsWith('/') || p.split('/').includes('..');

/**
 * Resolves one citation against a snapshot's new side.
 * Returns {path, startLine, endLine, lines:[{n,text}], truncated} or {error}.
 */
export async function resolveCitation(cit, snapshot) {
  if (unsafe(cit.path)) return { error: 'path must be relative to the checkout root' };
  const lines = await snapshot.lines('new', cit.path);
  if (!lines) return { error: 'file not found' };
  if (cit.startLine > lines.length) return { error: `file has ${lines.length} lines` };
  const startLine = cit.startLine;
  const endLine = Math.min(cit.endLine, lines.length);
  const shownEnd = Math.min(endLine, startLine + MAX_EXCERPT_LINES - 1);
  return {
    path: cit.path, startLine, endLine,
    lines: lines.slice(startLine - 1, shownEnd).map((text, i) => ({ n: startLine + i, text })),
    truncated: shownEnd < endLine,
  };
}

/** Resolves a message's citations at the snapshot of the round it was written in. */
export async function citationsForMessage(env, message) {
  const cits = parseCitations(message.body);
  if (!cits.length) return [];
  let snap;
  try { snap = await env.snapshot(message.round); } catch (e) {
    if (e.code) return cits.map((c) => ({ ...c, error: `snapshot unavailable (${e.code})` }));
    throw e;
  }
  return Promise.all(cits.map(async (c) => ({ raw: c.raw, ...(await resolveCitation(c, snap)) })));
}
