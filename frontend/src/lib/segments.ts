import type { Seg } from './highlight';
import type { Range } from './wordDiff';

export interface MarkedSeg extends Seg { em: boolean }

const inAny = (rs: Range[], a: number, b: number) => rs.some((r) => r.start <= a && b <= r.end);

/** Overlays word emphasis on a line's syntax segments: non-overlapping segments, each flagged when emphasis covers it; their texts concatenate to the line. */
export function mergeSegments(syntax: Seg[], emphasis: Range[]): MarkedSeg[] {
  const cuts = new Set<number>([0]);
  let pos = 0;
  for (const s of syntax) { pos += s.text.length; cuts.add(pos); }
  const len = pos;
  for (const r of emphasis) {
    cuts.add(Math.max(0, Math.min(len, r.start)));
    cuts.add(Math.max(0, Math.min(len, r.end)));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const out: MarkedSeg[] = [];
  let si = 0;
  let segStart = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    while (si < syntax.length && segStart + syntax[si].text.length <= a) { segStart += syntax[si].text.length; si++; }
    const s = syntax[si];
    out.push({ text: s.text.slice(a - segStart, b - segStart), cls: s.cls, em: inAny(emphasis, a, b) });
  }
  return out;
}
