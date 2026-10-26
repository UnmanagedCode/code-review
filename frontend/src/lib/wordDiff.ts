/** A half-open character range [start, end) within one line. */
export interface Range { start: number; end: number }

/** Lines longer than this, or with more tokens per side than WORD_DIFF_MAX_TOKENS, get no word-level emphasis. */
export const WORD_DIFF_MAX_CHARS = 1000;
export const WORD_DIFF_MAX_TOKENS = 300;
/**
 * The word-diff work one decoration (`decorateRows`, the whole file's rows) may spend, in `wordDiffCells`. Past it the
 * remaining lines get no emphasis, as past the per-line caps. About 20 ms of main thread, at the ~9 ns per cell
 * measured for 40-token code lines (Node 24 under vitest).
 */
export const WORD_DIFF_MAX_TOTAL_CELLS = 2_000_000;
// A pair's fixed setup, in cell-equivalents, so many tiny pairs also count.
const PAIR_SETUP_CELLS = 64;

const TOKEN_RE = /\w+|\s+|[^\w\s]/g;
const SPACE_RE = /^\s+$/;

/**
 * What `wordDiff(a, b)` costs: its LCS table's cells plus a fixed setup. Past the token cap it still tokenizes both
 * lines (linear in their characters); past the character cap it returns at once, for nothing.
 */
export function wordDiffCells(a: string, b: string): number {
  if (a.length > WORD_DIFF_MAX_CHARS || b.length > WORD_DIFF_MAX_CHARS) return 0;
  const n = a.match(TOKEN_RE)?.length ?? 0;
  const m = b.match(TOKEN_RE)?.length ?? 0;
  if (n > WORD_DIFF_MAX_TOKENS || m > WORD_DIFF_MAX_TOKENS) return a.length + b.length + PAIR_SETUP_CELLS;
  return (n + 1) * (m + 1) + PAIR_SETUP_CELLS;
}

/**
 * The changed characters of a deleted line `a` and its paired added line `b`: the tokens outside their longest
 * common token subsequence, as merged ranges per side. Null past the caps. With `ignoreWhitespace`, any two whitespace
 * runs count as equal and no range is whitespace only.
 */
export function wordDiff(a: string, b: string, opts: { ignoreWhitespace?: boolean } = {}): { a: Range[]; b: Range[] } | null {
  if (a.length > WORD_DIFF_MAX_CHARS || b.length > WORD_DIFF_MAX_CHARS) return null;
  const ta = a.match(TOKEN_RE) ?? [];
  const tb = b.match(TOKEN_RE) ?? [];
  if (ta.length > WORD_DIFF_MAX_TOKENS || tb.length > WORD_DIFF_MAX_TOKENS) return null;
  const key = (t: string) => (opts.ignoreWhitespace && SPACE_RE.test(t) ? ' ' : t);
  const ka = ta.map(key);
  const kb = tb.map(key);
  const n = ta.length;
  const m = tb.length;
  // lcs[i][j] = LCS length of ka[i..] and kb[j..].
  const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) lcs[i][j] = ka[i] === kb[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  }
  const keepA = new Array<boolean>(n).fill(false);
  const keepB = new Array<boolean>(m).fill(false);
  for (let i = 0, j = 0; i < n && j < m;) {
    if (ka[i] === kb[j]) { keepA[i++] = true; keepB[j++] = true; } else if (lcs[i + 1][j] >= lcs[i][j + 1]) i++; else j++;
  }
  const out = { a: ranges(ta, keepA), b: ranges(tb, keepB) };
  if (!opts.ignoreWhitespace) return out;
  const visible = (line: string) => (r: Range) => !SPACE_RE.test(line.slice(r.start, r.end));
  return { a: out.a.filter(visible(a)), b: out.b.filter(visible(b)) };
}

function ranges(tokens: string[], keep: boolean[]): Range[] {
  const out: Range[] = [];
  let pos = 0;
  tokens.forEach((t, i) => {
    if (!keep[i]) {
      const last = out.at(-1);
      if (last && last.end === pos) last.end += t.length; else out.push({ start: pos, end: pos + t.length });
    }
    pos += t.length;
  });
  return out;
}
