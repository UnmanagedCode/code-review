import { createHash } from 'node:crypto';

export const CONTEXT_LINES = 3;

const sha16 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

/** Hash of lines, ignoring trailing spaces/tabs/CR (leading indentation counts). */
export function linesHash(lines) {
  return sha16(lines.map((l) => l.replace(/[ \t\r]+$/, '')).join('\n'));
}

// Context blocks around the 0-based window [i, i+len): up to CONTEXT_LINES lines each side.
function contextAround(fileLines, i, len) {
  const before = fileLines.slice(Math.max(0, i - CONTEXT_LINES), i);
  const after = fileLines.slice(i + len, i + len + CONTEXT_LINES);
  return {
    ctxBefore: { hash: linesHash(before), n: before.length },
    ctxAfter: { hash: linesHash(after), n: after.length },
  };
}

const span = (h, side) => {
  const start = side === 'old' ? h.oldStart : h.newStart;
  const count = side === 'old' ? h.oldLines : h.newLines;
  return count > 0 ? [start, start + count - 1] : null;
};

/** The text hunk an anchor belongs to: the one containing `endLine`, else the last one overlapped, else null. */
export function hunkFor({ side, startLine, endLine }, hunks) {
  let overlapped = null;
  for (const h of hunks) {
    if (h.kind !== 'text') continue;
    const s = span(h, side);
    if (!s) continue;
    if (endLine >= s[0] && endLine <= s[1]) return h.id;
    if (startLine <= s[1] && endLine >= s[0]) overlapped = h.id;
  }
  return overlapped;
}

/** Builds an anchor over 1-based lines [startLine, endLine] of `fileLines` (that side's whole file). */
export function makeAnchor({ file, side, startLine, endLine, round, fileLines, hunks }) {
  const lines = fileLines.slice(startLine - 1, endLine);
  const anchor = {
    file, side, startLine, endLine, round,
    linesHash: linesHash(lines),
    lines,
    ...contextAround(fileLines, startLine - 1, lines.length),
    drifted: false,
  };
  anchor.hunkId = hunkFor(anchor, hunks);
  return anchor;
}

/**
 * Finds `anchor` in `newLines`. Returns {startLine, endLine, drifted} or null.
 * 'reanchor' falls back to unique surrounding context; 'volatile' never does.
 */
export function locate(anchor, newLines, mode) {
  const len = anchor.lines.length;
  const hits = [];
  for (let i = 0; i + len <= newLines.length; i++) {
    if (linesHash(newLines.slice(i, i + len)) !== anchor.linesHash) continue;
    const ctx = contextAround(newLines, i, len);
    const score = (ctx.ctxBefore.n === anchor.ctxBefore.n && ctx.ctxBefore.hash === anchor.ctxBefore.hash ? 1 : 0)
      + (ctx.ctxAfter.n === anchor.ctxAfter.n && ctx.ctxAfter.hash === anchor.ctxAfter.hash ? 1 : 0);
    hits.push({ i, score, dist: Math.abs(i + 1 - anchor.startLine) });
  }
  if (hits.length) {
    hits.sort((a, b) => b.score - a.score || a.dist - b.dist || a.i - b.i);
    const i = hits[0].i;
    return { startLine: i + 1, endLine: i + len, drifted: false };
  }
  if (mode !== 'reanchor') return null;
  const { ctxBefore, ctxAfter } = anchor;
  if (!ctxBefore.n || !ctxAfter.n) return null;
  const blockAt = (n, hash) => {
    const found = [];
    for (let i = 0; i + n <= newLines.length; i++) if (linesHash(newLines.slice(i, i + n)) === hash) found.push(i);
    return found;
  };
  const before = blockAt(ctxBefore.n, ctxBefore.hash);
  const after = blockAt(ctxAfter.n, ctxAfter.hash);
  if (before.length !== 1 || after.length !== 1) return null;
  const gapStart = before[0] + ctxBefore.n;
  const gap = after[0] - gapStart;
  if (gap < 1 || gap > 2 * len + 10) return null;
  return { startLine: gapStart + 1, endLine: gapStart + gap, drifted: true };
}
