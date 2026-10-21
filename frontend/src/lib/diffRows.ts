import type { DiffLine, Hunk, Side, TextHunk } from './types';

export interface Expansion { top: number; bottom: number }
export type Expansions = Record<string, Expansion>;

export type Row =
  | { kind: 'hunk'; key: string; hunk: Hunk; collapsed?: boolean }
  | { kind: 'line'; key: string; hunkId: string | null; line: DiffLine }
  | { kind: 'gap'; key: string; gapKey: string; remaining: number; from: number; to: number; side: Side };

export interface GapSpan { gapKey: string; from: number; to: number; offset: number }

export interface BuildInput {
  hunks: Hunk[];
  expansions: Expansions;
  /** Text of lines fetched for gaps, by line number on `side`. */
  texts: Record<number, string>;
  /** Line count of the file on `side`; null until known (the trailing gap is then omitted). */
  total: number | null;
  /** The side the file exists on: 'old' for a deleted file. */
  side?: Side;
}

const first = (h: TextHunk, side: Side) => (side === 'new' ? (h.newLines ? h.newStart : h.newStart + 1) : (h.oldLines ? h.oldStart : h.oldStart + 1));
const last = (h: TextHunk, side: Side) => (side === 'new' ? (h.newLines ? h.newStart + h.newLines - 1 : h.newStart) : (h.oldLines ? h.oldStart + h.oldLines - 1 : h.oldStart));
/** old − new at the end of the hunk: how far unchanged lines after it are shifted. */
const shiftAfter = (h: TextHunk) => last(h, 'old') - last(h, 'new');

/** The collapsible spans around and between the text hunks, in `side` coordinates (`offset` converts new → old). */
export function gapSpans(hunks: Hunk[], total: number | null, side: Side = 'new'): GapSpan[] {
  const text = hunks.filter((h): h is TextHunk => h.kind === 'text');
  if (!text.length) return [];
  const spans: GapSpan[] = [];
  const push = (gapKey: string, from: number, to: number, offset: number) => { if (to >= from) spans.push({ gapKey, from, to, offset }); };
  push('pre', 1, first(text[0], side) - 1, 0);
  text.forEach((h, i) => {
    const next = text[i + 1];
    const offset = side === 'new' ? shiftAfter(h) : 0;
    if (next) push(`after:${h.id}`, last(h, side) + 1, first(next, side) - 1, offset);
    else if (total != null) push(`after:${h.id}`, last(h, side) + 1, total, offset);
  });
  return spans;
}

const ctx = (n: number, side: Side, offset: number, text: string): DiffLine =>
  side === 'new' ? { t: 'ctx', old: n + offset, new: n, text } : { t: 'ctx', old: n, new: null, text };

/**
 * Flat render rows: hunk headers, diff lines, expanded context and the remaining collapsed gaps.
 * Each hunk header is followed by exactly its `hunk.lines`, in order (`collapseRows` relies on it).
 */
export function buildRows({ hunks, expansions, texts, total, side = 'new' }: BuildInput): Row[] {
  const rows: Row[] = [];
  const spans = new Map(gapSpans(hunks, total, side).map((s) => [s.gapKey, s]));
  const emitGap = (gapKey: string, hunkId: string | null) => {
    const span = spans.get(gapKey);
    if (!span) return;
    const size = span.to - span.from + 1;
    const e = expansions[gapKey] ?? { top: 0, bottom: 0 };
    const top = Math.min(e.top, size);
    const bottom = Math.min(e.bottom, size - top);
    const line = (n: number): Row => ({ kind: 'line', key: `${gapKey}:${n}`, hunkId, line: ctx(n, side, span.offset, texts[n] ?? '') });
    for (let n = span.from; n < span.from + top; n++) rows.push(line(n));
    const remaining = size - top - bottom;
    if (remaining > 0) rows.push({ kind: 'gap', key: `${gapKey}@${top}`, gapKey, remaining, from: span.from + top, to: span.to - bottom, side });
    for (let n = span.to - bottom + 1; n <= span.to; n++) rows.push(line(n));
  };
  emitGap('pre', null);
  for (const h of hunks) {
    rows.push({ kind: 'hunk', key: `h:${h.id}`, hunk: h });
    h.lines.forEach((line, i) => rows.push({ kind: 'line', key: `${h.id}:${i}`, hunkId: h.id, line }));
    if (h.kind === 'text') emitGap(`after:${h.id}`, h.id);
  }
  return rows;
}

/** The gap row (or expanded span) holding line `n` on `side`, for auto-expanding around a thread. */
export function gapHolding(hunks: Hunk[], total: number | null, side: Side, n: number, fileSide: Side = 'new'): (GapSpan & { size: number; fromTop: number; fromBottom: number }) | null {
  // Anchors on the old side of a modified file are always inside hunks (deleted lines) or shifted context.
  const spans = gapSpans(hunks, total, fileSide);
  for (const s of spans) {
    const m = side === fileSide ? n : n - s.offset;
    if (m >= s.from && m <= s.to) return { ...s, size: s.to - s.from + 1, fromTop: m - s.from + 1, fromBottom: s.to - m + 1 };
  }
  return null;
}

/** The rows with each collapsed hunk reduced to its header (marked `collapsed`): its own lines are dropped, context after it stays. */
export function collapseRows(rows: Row[], collapsed: (hunkId: string) => boolean): Row[] {
  const out: Row[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.kind === 'hunk' && collapsed(r.hunk.id)) {
      out.push({ ...r, collapsed: true });
      i += r.hunk.lines.length;
    } else out.push(r);
  }
  return out;
}
