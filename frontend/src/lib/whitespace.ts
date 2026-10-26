import type { DiffLine, Hunk, TextHunk } from './types';

/** A change run with more deleted × added lines than this is left as it is (the pairing is quadratic). */
export const WS_MAX_CELLS = 250_000;

// git's -w: whitespace is ignored when comparing lines; a missing end-of-file newline still counts.
const key = (l: DiffLine) => `${l.noEol ? '1' : '0'}${l.text.replace(/\s+/g, '')}`;

/** One change run: its deletions and additions with each pair that differs only in whitespace merged into one context line. */
function foldRun(run: DiffLine[]): DiffLine[] {
  const dels = run.filter((l) => l.t === 'del');
  const adds = run.filter((l) => l.t === 'add');
  if (!dels.length || !adds.length || dels.length * adds.length > WS_MAX_CELLS) return run;
  const n = dels.length;
  const m = adds.length;
  const dk = dels.map(key);
  const ak = adds.map(key);
  const w = m + 1;
  // lcs[i * w + j] = LCS length of dels[i..] and adds[j..] by key.
  const lcs = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) lcs[i * w + j] = dk[i] === ak[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
  }
  if (!lcs[0]) return run;
  const out: DiffLine[] = [];
  let di = 0;
  let ai = 0;
  const flushTo = (i: number, j: number) => {
    while (di < i) out.push(dels[di++]);
    while (ai < j) out.push(adds[ai++]);
  };
  for (let i = 0, j = 0; i < n && j < m;) {
    if (dk[i] === ak[j]) {
      flushTo(i, j);
      const d = dels[di++];
      const a = adds[ai++];
      out.push({ t: 'ctx', old: d.old, new: a.new, text: a.text, ...(a.noEol ? { noEol: true } : {}) });
      i++; j++;
    } else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) i++; else j++;
  }
  flushTo(n, m);
  return out;
}

/**
 * The hunks as shown with Ignore whitespace on: in each change run (the deletions and additions between context
 * lines), a deleted and an added line that differ only in whitespace become one context line carrying both numbers
 * and the new text. Display only: ids, coordinates, headers and verdicts are kept, and every old and new line number
 * keeps exactly one row, in order. An unchanged hunk is returned as is.
 */
export function ignoreWhitespace(hunks: Hunk[]): Hunk[] {
  let changed = false;
  const out = hunks.map((h) => {
    if (h.kind !== 'text') return h;
    const lines: DiffLine[] = [];
    let run: DiffLine[] = [];
    const flush = () => { lines.push(...foldRun(run)); run = []; };
    for (const l of h.lines) {
      if (l.t === 'ctx') { flush(); lines.push(l); } else run.push(l);
    }
    flush();
    if (lines.every((l, i) => l === h.lines[i])) return h;
    changed = true;
    return { ...h, lines } satisfies TextHunk;
  });
  return changed ? out : hunks;
}

/** A text hunk with no deleted or added line left: only `ignoreWhitespace` produces one. */
export const isWhitespaceOnly = (h: Hunk): boolean => h.kind === 'text' && h.lines.every((l) => l.t === 'ctx');
