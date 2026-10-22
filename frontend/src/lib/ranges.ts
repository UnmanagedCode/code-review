import { formatLines } from './route';
import type { Side, Thread, ThreadKind } from './types';

/** `L3` or `L3–L5`. */
export const lineSpan = (start: number, end: number): string => `L${formatLines(start, end).replace('-', '–L')}`;

/** `L3–L5 (new)`: a range with its side, as cards, the composer and the gutter's accessible name show it. */
export const rangeLabel = (r: { side: Side; startLine: number; endLine: number }): string => `${lineSpan(r.startLine, r.endLine)} (${r.side})`;

/** Rail lanes per gutter; deeper overlaps share the last one. */
export const MAX_LANES = 3;

/** One thread's range rail on one line: its lane, whether the line starts or ends the range, and its accessible label. */
export interface RangeMark { threadId: string; kind: ThreadKind; lane: number; first: boolean; last: boolean; active: boolean; label: string }

interface Laned { t: Thread; lane: number }
const NONE: RangeMark[] = [];

/**
 * The single decision of which lines carry a thread's range rail: every line of each non-outdated thread's anchor, on
 * the anchor's side. Lanes are assigned per side over the whole list (not the visible rows), so expanding a gap never
 * moves a rail; ranges that overlap or touch never share a lane.
 */
export function rangeMarks(threads: Thread[], activeId?: string): (side: Side, n: number) => RangeMark[] {
  const bySide: Record<Side, Laned[]> = { old: [], new: [] };
  for (const side of ['old', 'new'] as const) {
    const list = threads.filter((t) => t.status !== 'outdated' && t.anchor.side === side).sort((a, b) =>
      a.anchor.startLine - b.anchor.startLine || b.anchor.endLine - a.anchor.endLine || a.id.localeCompare(b.id, undefined, { numeric: true }));
    const lastEnd: number[] = [];
    for (const t of list) {
      let lane = lastEnd.findIndex((end) => end < t.anchor.startLine - 1);
      if (lane < 0) lane = Math.min(lastEnd.length, MAX_LANES - 1);
      lastEnd[lane] = Math.max(lastEnd[lane] ?? 0, t.anchor.endLine);
      bySide[side].push({ t, lane });
    }
  }
  return (side, n) => {
    const hits = bySide[side].filter(({ t }) => n >= t.anchor.startLine && n <= t.anchor.endLine);
    if (!hits.length) return NONE;
    return hits.map(({ t, lane }) => ({
      threadId: t.id, kind: t.kind, lane, first: n === t.anchor.startLine, last: n === t.anchor.endLine,
      active: t.id === activeId, label: `${t.kind} thread ${rangeLabel(t.anchor)}`,
    }));
  };
}

/** The suffix a gutter cell's accessible name gets from the ranges it sits in. */
export const markNote = (marks: RangeMark[]): string => (marks.length ? ` · in ${marks.map((m) => m.label).join(', ')}` : '');
