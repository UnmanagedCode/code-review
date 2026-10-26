import type { Row } from './diffRows';
import { highlightLines, type Seg, type Tokenize } from './highlight';
import { mergeSegments, type MarkedSeg } from './segments';
import type { DiffLine, Side } from './types';
import { wordDiff, type Range } from './wordDiff';

/** A line's text as highlighted and shown: a trailing CR is dropped. */
export const displayText = (line: DiffLine) => line.text.replace(/\r$/, '');

/**
 * Each line's display segments: syntax from highlighting each file side once (the rows' lines that carry an old,
 * resp. new, number, in row order), merged with word emphasis. Deleted lines take old-side segments, added lines
 * new-side ones and context lines `side`'s (the side the file exists on). Within a run of deletions and additions
 * (between context, hunk and gap rows) the n-th deletion is paired with the n-th addition, as `splitRows` pairs them.
 * Keyed by line object: `collapseRows` and `splitRows` reuse the rows' lines.
 */
export function decorateRows(rows: Row[], lang: string | null, tokenize: Tokenize | null, opts: { side: Side; ignoreWhitespace: boolean }): Map<DiffLine, MarkedSeg[]> {
  const lines = rows.flatMap((r) => (r.kind === 'line' ? [r.line] : []));
  const highlight = (s: Side) => {
    const own = lines.filter((l) => l[s] != null);
    const segs = highlightLines(own.map(displayText).join('\n'), lang, tokenize);
    return new Map(own.map((l, i) => [l, segs[i]]));
  };
  const sides = { old: highlight('old'), new: highlight('new') };
  const syntax = (l: DiffLine): Seg[] => {
    const s: Side = l.t === 'del' ? 'old' : l.t === 'add' ? 'new' : l[opts.side] != null ? opts.side : opts.side === 'new' ? 'old' : 'new';
    return sides[s].get(l) ?? [{ text: displayText(l), cls: null }];
  };

  const emphasis = new Map<DiffLine, Range[]>();
  let dels: DiffLine[] = [];
  let adds: DiffLine[] = [];
  const flush = () => {
    for (let i = 0; i < Math.min(dels.length, adds.length); i++) {
      const w = wordDiff(displayText(dels[i]), displayText(adds[i]), { ignoreWhitespace: opts.ignoreWhitespace });
      if (w) { emphasis.set(dels[i], w.a); emphasis.set(adds[i], w.b); }
    }
    dels = [];
    adds = [];
  };
  for (const r of rows) {
    if (r.kind === 'line' && r.line.t === 'del') dels.push(r.line);
    else if (r.kind === 'line' && r.line.t === 'add') adds.push(r.line);
    else flush();
  }
  flush();

  return new Map(lines.map((l) => [l, mergeSegments(syntax(l), emphasis.get(l) ?? [])]));
}
