import { anchorView, locate, makeAnchor } from './anchor.js';

/**
 * Moves each non-outdated thread to where its lines now sit in `snap`.
 * mode 'reanchor' (refresh): unlocatable threads become outdated.
 * mode 'volatile' (uncommitted sweep): unlocatable threads are deleted and remembered in droppedThreads.
 * `renames` maps new path -> old path between the previous and the new head. `round` is the round the anchors now belong to:
 * their `lines` and `linesHash` are re-read from that round's snapshot. On a range review (always a move to a new round)
 * the old anchor is kept in `pastAnchors` first, so the thread's position in every earlier round stays known; uncommitted
 * reviews have no past-round views and keep none.
 * A file anchor follows its file (a rename included) wherever it is in `snap`, binary or not; a review anchor never moves.
 */
export async function followThreads(review, snap, mode, { renames = {}, round }) {
  const report = { moved: 0, drifted: 0, outdated: 0, dropped: 0 };
  const toNew = new Map(Object.entries(renames).map(([n, o]) => [o, n]));
  const cache = new Map();
  const linesOf = async (side, p) => {
    const key = `${side}\0${p}`;
    if (!cache.has(key)) cache.set(key, await snap.lines(side, p));
    return cache.get(key);
  };
  const gone = new Set();
  const lose = (t) => {
    if (mode === 'volatile') { gone.add(t.id); report.dropped++; } else { t.status = 'outdated'; report.outdated++; }
  };
  for (const t of review.threads) {
    if (t.status === 'outdated' || t.anchor.kind === 'review') continue;
    const a = t.anchor;
    const file = toNew.get(a.file) ?? a.file;
    const f = snap.files.find((x) => x.path === file);
    if (a.kind === 'file') {
      if (!f) { lose(t); continue; }
      if (file !== a.file) report.moved++;
      if (review.kind === 'range') t.pastAnchors.push(anchorView(a));
      t.anchor = { kind: 'file', file, round };
      continue;
    }
    const fileLines = f && !f.binary && !f.tooLarge ? await linesOf(a.side, file) : null;
    const loc = fileLines && locate(a, fileLines, mode);
    if (!loc) { lose(t); continue; }
    const next = makeAnchor({ file, side: a.side, startLine: loc.startLine, endLine: loc.endLine, round, fileLines, hunks: f.hunks });
    next.drifted = loc.drifted;
    if (loc.drifted) report.drifted++;
    else if (next.startLine !== a.startLine || next.file !== a.file) report.moved++;
    if (review.kind === 'range') t.pastAnchors.push(anchorView(a));
    t.anchor = next;
  }
  if (gone.size) {
    review.threads = review.threads.filter((t) => !gone.has(t.id));
    review.droppedThreads.push(...gone);
  }
  return report;
}
