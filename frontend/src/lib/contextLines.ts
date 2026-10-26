import { gapSpans, type Expansions } from './diffRows';
import { GIT_CONTEXT_LINES } from './gitContext';
import type { Hunk, Side, TextHunk } from './types';

/**
 * Gap expansion that shows `n` context lines around each hunk when `n` is above git's GIT_CONTEXT_LINES: the extra
 * lines at each gap edge that touches a hunk (the leading gap's bottom, both edges between hunks, the trailing gap's
 * top), clamped to the gap. Empty at or below git's context.
 */
export function contextBaseline(hunks: Hunk[], total: number | null, n: number, side: Side = 'new'): Expansions {
  const extra = n - GIT_CONTEXT_LINES;
  if (extra <= 0) return {};
  const text = hunks.filter((h): h is TextHunk => h.kind === 'text');
  const lastKey = text.length ? `after:${text[text.length - 1].id}` : null;
  const out: Expansions = {};
  for (const s of gapSpans(hunks, total, side)) {
    const size = s.to - s.from + 1;
    const top = s.gapKey === 'pre' ? 0 : Math.min(extra, size);
    const bottom = s.gapKey === lastKey ? 0 : Math.min(extra, size - top);
    out[s.gapKey] = { top, bottom };
  }
  return out;
}

/**
 * The hunks as shown with fewer than git's context lines: each text hunk's leading and trailing context cut to `n`,
 * its coordinates moved so the cut lines fall into the neighbouring gaps (a side left empty takes git's `-U0` start, the
 * line before). Context between two changes in one hunk is kept: verdicts are per hunk. With `keepTail` false (the
 * trailing gap is not known yet) the last hunk keeps its trailing context, which would otherwise have no gap to go to.
 * `seeded` is the cut lines' text by their number on `side`, so a gap opened over them needs no fetch.
 */
export function trimContext(hunks: Hunk[], n: number, { keepTail, side = 'new' }: { keepTail: boolean; side?: Side }): { hunks: Hunk[]; seeded: Record<number, string> } {
  const seeded: Record<number, string> = {};
  if (n >= GIT_CONTEXT_LINES) return { hunks, seeded };
  const lastText = hunks.findLast((h) => h.kind === 'text');
  const out = hunks.map((h): Hunk => {
    if (h.kind !== 'text') return h;
    const lead = h.lines.findIndex((l) => l.t !== 'ctx');
    if (lead < 0) return h;
    let trail = 0;
    while (h.lines[h.lines.length - 1 - trail].t === 'ctx') trail++;
    const cutLead = Math.max(0, lead - n);
    const cutTrail = h === lastText && !keepTail ? 0 : Math.max(0, trail - n);
    if (!cutLead && !cutTrail) return h;
    const cut = [...h.lines.slice(0, cutLead), ...h.lines.slice(h.lines.length - cutTrail)];
    for (const l of cut) if (l[side] != null) seeded[l[side]] = l.text;
    // A side with no lines left starts at the line before (git's convention), so the gaps on both sides stay exact.
    const coords = (start: number, count: number) => {
      const left = count - cutLead - cutTrail;
      return [left ? start + cutLead : start + cutLead - 1, left] as const;
    };
    const [oldStart, oldLines] = coords(h.oldStart, h.oldLines);
    const [newStart, newLines] = coords(h.newStart, h.newLines);
    return { ...h, lines: h.lines.slice(cutLead, h.lines.length - cutTrail), oldStart, oldLines, newStart, newLines };
  });
  return { hunks: out, seeded };
}
