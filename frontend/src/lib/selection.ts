import type { Row } from './diffRows';
import type { DiffLine, Side } from './types';

export interface Selection { side: Side; start: number; end: number; anchorLine: number }
type Span = Pick<Selection, 'side' | 'start' | 'end'>;

/** The line number a row carries on `side`, or null (hunk header, gap, or a row without that side). */
export function lineOn(row: Row, side: Side): number | null {
  return row.kind === 'line' ? row.line[side] : null;
}

export const startSelection = (side: Side, n: number): Selection => ({ side, start: n, end: n, anchorLine: n });

/**
 * Extends the selection from its anchor to line `n` on the same side. The range stops before a collapsed
 * gap or collapsed hunk (or the end of the rendered rows) between the anchor and `n`; once expanded the range may span it.
 */
export function extendSelection(rows: Row[], sel: Selection, n: number): Selection {
  const idx = (line: number) => rows.findIndex((r) => lineOn(r, sel.side) === line);
  const a = idx(sel.anchorLine);
  const b = idx(n);
  if (a < 0 || b < 0) return sel;
  const step = b >= a ? 1 : -1;
  let reached = sel.anchorLine;
  for (let i = a; i !== b + step; i += step) {
    const r = rows[i];
    if (r.kind === 'gap' || (r.kind === 'hunk' && r.collapsed)) break;
    const m = lineOn(r, sel.side);
    if (m != null) reached = m;
  }
  return { side: sel.side, start: Math.min(sel.anchorLine, reached), end: Math.max(sel.anchorLine, reached), anchorLine: sel.anchorLine };
}

/** Whether line `n` on `side` is inside `sel` (a selection, or any span on one side such as a thread's range). */
export const contains = (sel: Span | null, side: Side, n: number | null): boolean =>
  !!sel && sel.side === side && n != null && n >= sel.start && n <= sel.end;

/** Whether any of `lines` carries, on the selection's side, a number inside it. */
export const selectionTouches = (sel: Span | null, lines: DiffLine[]): boolean =>
  !!sel && lines.some((l) => contains(sel, sel.side, l[sel.side]));
