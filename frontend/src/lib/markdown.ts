// Message body (markdown subset) -> typed AST. Pure.
//
// Bodies are written by models and so are untrusted, and the page runs in an
// unsandboxed same-origin iframe of cc, whose API has no auth. This parser
// never emits markup: raw HTML (comments included) is literal text, the node
// types are the fixed ones below, and text only ever lands in `text` nodes.
// A `link` href is always `safeHref`-normalised (http, https, mailto); a
// `cite` comes only from the server's parsed citation list. Images become
// links labelled by their alt text, so nothing loads.
//
// Linearity: every delimiter search is answered from tables built at most once
// per inline run (backtick runs by length, bracket pairs, destination scanners,
// the atom table) or memoised along the path it walked, and every block
// matcher is a linear regex or loop, so parsing stays amortized linear in the
// input length. Never add a `…+$` or nested-quantifier regex here.
//
// Unsupported: indented code blocks, setext headings, reference links.
// A single newline inside a paragraph is a line break (`br`).
import { safeHref } from './safeHref';
import type { Citation } from './types';

export type Align = 'left' | 'center' | 'right' | null;
export type Text = { t: 'text'; v: string };
export type Cite = { t: 'cite'; path: string; start: number; end: number; c: Inline[] };
export type Inline =
  | Text
  | { t: 'br' }
  | { t: 'code'; c: (Text | Cite)[] }
  | { t: 'em' | 'strong' | 'del'; c: Inline[] }
  | { t: 'link'; href: string; c: Inline[] }
  | Cite;
export type Block =
  | { t: 'p'; c: Inline[] }
  | { t: 'h'; level: number; c: Inline[] }
  | { t: 'pre'; text: string }
  | { t: 'ul' | 'ol'; start?: number; tight: boolean; items: Block[][] }
  | { t: 'quote'; c: Block[] }
  | { t: 'table'; align: Align[]; head: Inline[][]; rows: Inline[][][] }
  | { t: 'hr' };

// Every quantifier that precedes a `(.*)$` is closed off by a lookahead: `.`
// stops at U+2028/U+2029, so on such a line `$` fails, and without the
// lookahead the quantifier would give back one character at a time, each
// retry rescanning the rest of the line (quadratic in the line length).
const FENCE_RE = /^( {0,3})(`{3,}(?!`)|~{3,}(?!~))(.*)$/;
const ATX_RE = /^ {0,3}(#{1,6})(?=[ \t]|$)(.*)$/;
const HR_RE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE_RE = /^ {0,3}> ?/;
const LIST_RE = /^( *)([-*+]|(\d{1,9})([.)]))(?:( +)(?! )(.*))?$/;
const DELIM_CELL_RE = /^ *:?-+:? *$/;
const AUTO_RE = /<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s<>]*)>/y;
const PUNCT_RE = /[!-/:-@[-`{-~]/;
const ENTITY_RE = /^&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|(amp|lt|gt|quot|apos|nbsp));/;
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const WORD_RE = /[\p{L}\p{N}]/u;
// Citation runs: the path characters, and the characters that may not precede
// a citation (the lookbehind of CITATION_RE in src/citations.js).
const PATH_RE = /[A-Za-z0-9_./-]/;
const CITE_PREV_RE = /[A-Za-z0-9_/.:-]/;
const ALNUM_RE = /[A-Za-z0-9]/;
const URL_STOP_RE = /[\s\x00-\x1f<>"`[\]]/;
// No `)`: a URL never holds an unbalanced one (see urlEnd), so a trailing `)` always closes its own `(` (the GFM
// rule). No `]`: it stops the scan.
const URL_TRAILING = new Set('.,;:!?*_~\'"}');

// Deepest block (quote/list) or inline (emphasis) nesting parsed as structure.
// Past it the remaining content is plain text, so no body can exhaust the stack.
export const MAX_NESTING = 32;

// Same rule as `unsafe()` in src/citations.js.
const unsafePath = (p: string): boolean => p.startsWith('/') || p.split('/').includes('..');

/** Parses a message body. `citations` is the server's list for it: only those (minus unsafe paths) become `cite` nodes. */
export function parseMarkdown(body: string, citations: Citation[]): Block[] {
  const cites = new Map<string, Citation>();
  for (const c of citations) if (!unsafePath(c.path)) cites.set(c.raw, c);
  const lines = body.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n').map(expandTabs);
  return parseBlocks(lines, cites, 0);
}

type Cites = Map<string, Citation>;

function expandTabs(s: string): string {
  if (!s.includes('\t')) return s;
  let out = '';
  let col = 0;
  let i = 0;
  for (; i < s.length; i++) {
    if (s[i] === '\t') { const w = 4 - (col % 4); out += ' '.repeat(w); col += w; } else if (s[i] === ' ') { out += ' '; col++; } else break;
  }
  return out + s.slice(i);
}

const isBlank = (s: string) => /^[ \t]*$/.test(s);
const indentOf = (s: string) => s.length - s.trimStart().length;

function plainText(inlines: Inline[]): string {
  let s = '';
  for (const n of inlines) {
    if (n.t === 'text') s += n.v;
    else if (n.t === 'br') s += ' ';
    else s += plainText(n.c);
  }
  return s;
}

type Marker = { ordered: boolean; kind: string; start?: number; contentIndent: number; content: string };

function listMarker(s: string): Marker | null {
  const m = LIST_RE.exec(s);
  if (!m) return null;
  const ordered = m[3] !== undefined;
  const indent = m[1].length;
  const width = m[2].length;
  const spaces = m[5] ?? '';
  const rest = m[6] ?? '';
  const contentIndent = (rest === '' || spaces.length > 4) ? indent + width + 1 : indent + width + spaces.length;
  return {
    ordered,
    kind: ordered ? m[4] : m[2],
    start: ordered ? Number(m[3]) : undefined,
    contentIndent,
    content: spaces.length > 4 ? spaces.slice(1) + rest : rest,
  };
}

// An ATX heading's closing sequence: trailing `#`s preceded by spaces/tabs (or
// making up the whole string) are dropped with that whitespace. A loop, not an
// unanchored regex, which would rescan each whitespace run from every start.
function stripClosingHashes(s: string): string {
  let j = s.length;
  while (j > 0 && s[j - 1] === '#') j--;
  if (j === s.length) return s;
  if (j === 0) return '';
  if (s[j - 1] !== ' ' && s[j - 1] !== '\t') return s;
  while (j > 0 && (s[j - 1] === ' ' || s[j - 1] === '\t')) j--;
  return s.slice(0, j);
}

// A table delimiter row: optional outer pipes, then `|`-separated cells each
// `:?-+:?` padded with spaces (U+0020 only). Checked cell by cell, so it is
// linear: a single regex over the whole row backtracks quadratically on runs
// of spaces around a pipe.
function isDelimRow(line: string): boolean {
  let i = 0;
  let j = line.length;
  while (i < j && line[i] === ' ') i++;
  if (line[i] === '|') i++;
  while (j > i && line[j - 1] === ' ') j--;
  if (j > i && line[j - 1] === '|') {
    j--;
    while (j > i && line[j - 1] === ' ') j--;
  }
  if (i >= j) return false;
  for (const cell of line.slice(i, j).split('|')) if (!DELIM_CELL_RE.test(cell)) return false;
  return true;
}

function isTableStart(recs: string[], i: number): boolean {
  if (i + 1 >= recs.length || !recs[i].includes('|')) return false;
  const d = recs[i + 1];
  if (!d.includes('|') || !isDelimRow(d)) return false;
  return splitCells(recs[i]).length === splitCells(d).length;
}

// Lines that end a paragraph (and so may not be lazy continuations).
function startsBlock(recs: string[], i: number): boolean {
  const s = recs[i];
  if (ATX_RE.test(s) || FENCE_RE.test(s) || HR_RE.test(s) || QUOTE_RE.test(s)) return true;
  const m = listMarker(s);
  if (m && m.content.trim() !== '' && (!m.ordered || m.start === 1)) return true;
  return isTableStart(recs, i);
}

function parseBlocks(recs: string[], cites: Cites, depth: number): Block[] {
  if (depth > MAX_NESTING) {
    const v = recs.map((s) => s.trim()).filter(Boolean).join(' ');
    return v ? [{ t: 'p', c: [{ t: 'text', v }] }] : [];
  }
  const out: Block[] = [];
  let i = 0;
  while (i < recs.length) {
    const s = recs[i];
    if (isBlank(s)) { i++; continue; }

    let m = FENCE_RE.exec(s);
    if (m && !(m[2][0] === '`' && m[3].includes('`'))) {
      const indent = m[1].length;
      const closeRe = new RegExp(`^ {0,3}${m[2][0] === '`' ? '`' : '~'}{${m[2].length},}[ \\t]*$`);
      const body: string[] = [];
      let k = i + 1;
      while (k < recs.length && !closeRe.test(recs[k])) {
        body.push(recs[k].slice(Math.min(indent, indentOf(recs[k]))));
        k++;
      }
      out.push({ t: 'pre', text: body.join('\n') });
      i = k + 1;
      continue;
    }

    m = ATX_RE.exec(s);
    if (m) {
      let content = stripClosingHashes(m[2].trim()).trim();
      if (/^#+$/.test(content)) content = '';
      out.push({ t: 'h', level: m[1].length, c: inlines([content], cites) });
      i++;
      continue;
    }

    if (HR_RE.test(s)) { out.push({ t: 'hr' }); i++; continue; }

    if (QUOTE_RE.test(s)) {
      const inner: string[] = [];
      while (i < recs.length) {
        const r = recs[i];
        if (QUOTE_RE.test(r)) inner.push(r.replace(QUOTE_RE, ''));
        else if (!isBlank(r) && inner.length && !isBlank(inner[inner.length - 1]) && !startsBlock(recs, i)) inner.push(r);
        else break;
        i++;
      }
      out.push({ t: 'quote', c: parseBlocks(inner, cites, depth + 1) });
      continue;
    }

    const lm = listMarker(s);
    if (lm) {
      const r = parseList(recs, i, lm, cites, depth);
      out.push(r.node);
      i = r.next;
      continue;
    }

    if (isTableStart(recs, i)) {
      const head = splitCells(recs[i]);
      const align = splitCells(recs[i + 1]).map((d): Align => {
        const l = d.startsWith(':');
        const r = d.endsWith(':');
        return l && r ? 'center' : r ? 'right' : l ? 'left' : null;
      });
      const rows: Inline[][][] = [];
      let k = i + 2;
      const isRow = (r: string) => !isBlank(r) && r.includes('|') && (r.trimStart().startsWith('|') || !startsBlock(recs, k));
      while (k < recs.length && isRow(recs[k])) {
        const cells = splitCells(recs[k]);
        rows.push(head.map((_, c) => inlines([cells[c] ?? ''], cites)));
        k++;
      }
      out.push({ t: 'table', align, head: head.map((h) => inlines([h], cites)), rows });
      i = k;
      continue;
    }

    // Paragraph.
    const para = [recs[i]];
    i++;
    while (i < recs.length && !isBlank(recs[i]) && !startsBlock(recs, i)) { para.push(recs[i]); i++; }
    out.push({ t: 'p', c: inlines(para, cites) });
  }
  return out;
}

function parseList(recs: string[], i: number, first: Marker, cites: Cites, depth: number): { node: Block; next: number } {
  const items: Block[][] = [];
  let tight = true;
  let gapBeforeNext = false;
  while (i < recs.length) {
    const m = listMarker(recs[i]);
    if (!m || m.ordered !== first.ordered || m.kind !== first.kind) break;
    if (gapBeforeNext) tight = false;
    const lines = [m.content];
    const ci = m.contentIndent;
    let inFence = FENCE_RE.test(m.content);
    i++;
    while (i < recs.length) {
      const r = recs[i];
      if (isBlank(r)) { lines.push(''); i++; continue; }
      if (indentOf(r) >= ci) {
        const line = r.slice(ci);
        if (FENCE_RE.test(line)) inFence = !inFence;
        lines.push(line);
        i++;
        continue;
      }
      if (!inFence && !isBlank(lines[lines.length - 1]) && !startsBlock(recs, i) && !listMarker(r)) {
        lines.push(r.trimStart());
        i++;
        continue;
      }
      break;
    }
    let trailing = 0;
    while (lines.length > 1 && isBlank(lines[lines.length - 1])) { lines.pop(); trailing++; }
    if (lines.some(isBlank)) tight = false;
    gapBeforeNext = trailing > 0;
    items.push(parseBlocks(lines, cites, depth + 1));
  }
  const node: Block = first.ordered ? { t: 'ol', start: first.start, tight, items } : { t: 'ul', tight, items };
  return { node, next: i };
}

// Cells of a table row: outer pipes stripped, split on unescaped `|`, `\|` -> `|`.
function splitCells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
    if (s[i] === '|') { cells.push(cur.trim()); cur = ''; continue; }
    cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

// ---- inlines ----------------------------------------------------------------

type Tables = {
  match: Int32Array; P: Int32Array; nextDrop: Int32Array; nextStop: Int32Array; nextNonWs: Int32Array;
  nextQ: Record<'"' | "'" | ')', Int32Array>;
};
type Cx = { S: string; cites: Cites; memo: Map<string, Int32Array>; runs?: Map<number, number[]>; T?: Tables; A?: Int32Array };

function inlines(lines: string[], cites: Cites): Inline[] {
  const S = lines.map((s) => s.trim()).join('\n');
  return inl(0, S.length, { S, cites, memo: new Map() }, false, 0);
}

function runLen(S: string, i: number, to: number, ch: string): number {
  let j = i;
  while (j < to && S[j] === ch) j++;
  return j - i;
}

// Maximal backtick runs grouped by length: len -> ascending start positions.
function backtickRuns(cx: Cx): Map<number, number[]> {
  if (cx.runs) return cx.runs;
  const { S } = cx;
  const runs = new Map<number, number[]>();
  for (let i = S.indexOf('`'); i >= 0; i = S.indexOf('`', i)) {
    const n = runLen(S, i, S.length, '`');
    if (!runs.has(n)) runs.set(n, []);
    runs.get(n)!.push(i);
    i += n;
  }
  cx.runs = runs;
  return runs;
}

// Start of the first backtick run of exactly n starting at or after `from`
// and ending by `to`, or -1.
function backtickClose(cx: Cx, from: number, to: number, n: number): number {
  const list = backtickRuns(cx).get(n);
  if (!list) return -1;
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] < from) lo = mid + 1; else hi = mid;
  }
  return lo < list.length && list[lo] + n <= to ? list[lo] : -1;
}

// Skip a whole code span (or an unmatched run) starting at j.
function skipCode(cx: Cx, j: number): number {
  const n = runLen(cx.S, j, cx.S.length, '`');
  const cl = backtickClose(cx, j + n, cx.S.length, n);
  return cl >= 0 ? cl + n : j + n;
}

// End of the citation-shaped text `run#Ln[-Lm]` whose run starts at j, or -1.
// Only finds the token's extent: whether it is a citation is the server's list's call.
function citeEnd(S: string, j: number): number {
  let k = j;
  while (k < S.length && PATH_RE.test(S[k])) k++;
  if (!S.startsWith('#L', k)) return -1;
  let e = k + 2;
  const digits = (p: number) => { let q = p; while (q < S.length && S[q] >= '0' && S[q] <= '9') q++; return q; };
  const d = digits(e);
  if (d === e) return -1;
  e = d;
  if (S.startsWith('-L', e)) {
    const d2 = digits(e + 2);
    if (d2 > e + 2) e = d2;
  }
  return e;
}

// A citation may start at j when nothing that could extend its path precedes it.
const citeBoundary = (S: string, j: number) => PATH_RE.test(S[j]) && (j === 0 || !CITE_PREV_RE.test(S[j - 1]));

// End of a bare-URL candidate starting at j (trailing punctuation trimmed), and where its scan stopped. The scan
// stops at whitespace, a control character, `<>"\`[]`, or a `)` closing a paren the URL did not open, with escapes
// counted as linkTables counts them: so a URL inside a link destination never runs past the destination's closing
// `)` and swallows a delimiter outside it (`**[x](https://q.com)**`).
function urlEnd(S: string, j: number): { end: number; stop: number } {
  let open = 0;
  let stop = j;
  while (stop < S.length) {
    const c = S[stop];
    if (URL_STOP_RE.test(c)) break;
    if (c === '\\' && stop + 1 < S.length && PUNCT_RE.test(S[stop + 1]) && !URL_STOP_RE.test(S[stop + 1])) { stop += 2; continue; }
    if (c === '(') open++;
    else if (c === ')') { if (open === 0) break; open--; }
    stop++;
  }
  let end = stop;
  while (end > j && URL_TRAILING.has(S[end - 1])) end--;
  return { end, stop };
}

// Atom table: A[j] > j when a listed citation or a bare http(s) URL spans
// [j, A[j]). Atoms are consumed whole, so emphasis never splits them
// (`src/__init__.py#L3` stays one citation). Built once per inline run,
// skipping escapes and code spans as inl() does. Positions inside a path run
// are never citation boundaries, and once a URL candidate is tried no other
// starts inside its scan, so each character is scanned a bounded number of times.
function atoms(cx: Cx): Int32Array {
  if (cx.A) return cx.A;
  const { S } = cx;
  const n = S.length;
  const A = new Int32Array(n);
  let urlFrom = 0;
  for (let j = 0; j < n;) {
    const c = S[j];
    if (c === '\\' && j + 1 < n && PUNCT_RE.test(S[j + 1])) { j += 2; continue; }
    if (c === '`') { j = skipCode(cx, j); continue; }
    if (c === 'h' && j >= urlFrom && (S.startsWith('http://', j) || S.startsWith('https://', j)) && !(j > 0 && ALNUM_RE.test(S[j - 1]))) {
      const { end, stop } = urlEnd(S, j);
      urlFrom = stop;
      if (safeHref(S.slice(j, end))) { A[j] = end; j = end; continue; }
    }
    if (citeBoundary(S, j)) {
      const e = citeEnd(S, j);
      if (e > 0 && cx.cites.has(S.slice(j, e))) { A[j] = e; j = e; continue; }
    }
    j++;
  }
  cx.A = A;
  return A;
}

function citeNode(c: Citation, label: Inline[]): Cite {
  return { t: 'cite', path: c.path, start: c.startLine, end: c.endLine, c: label };
}

// A code span's content: listed citations become `cite` children; nothing else links.
function codeChildren(v: string, cites: Cites): (Text | Cite)[] {
  const out: (Text | Cite)[] = [];
  let at = 0;
  for (let j = 0; j < v.length; j++) {
    if (!citeBoundary(v, j)) continue;
    const e = citeEnd(v, j);
    const c = e > 0 ? cites.get(v.slice(j, e)) : undefined;
    if (!c) continue;
    if (j > at) out.push({ t: 'text', v: v.slice(at, j) });
    out.push(citeNode(c, [{ t: 'text', v: v.slice(j, e) }]));
    at = e;
    j = e - 1;
  }
  if (at < v.length) out.push({ t: 'text', v: v.slice(at) });
  return out;
}

// Memoised forward scan: every position visited while answering one query
// records that query's answer, so later queries starting on the same path
// return in O(1). `step(j)` returns the answer at j, or the next j to visit.
function memoScan(cx: Cx, key: string, from: number, step: (j: number) => { hit: number } | { next: number }): number {
  let memo = cx.memo.get(key);
  if (!memo) { memo = new Int32Array(cx.S.length + 1).fill(-2); cx.memo.set(key, memo); }
  const path: number[] = [];
  let j = from;
  let res: number;
  for (;;) {
    if (j >= cx.S.length) { res = -1; break; }
    if (memo[j] !== -2) { res = memo[j]; break; }
    path.push(j);
    const r = step(j);
    if ('hit' in r) { res = r.hit; break; }
    j = r.next;
  }
  for (const p of path) memo[p] = res;
  return res;
}

// Index of `seq` at or after `from` (ending by `to`), skipping escapes, whole code spans and whole atoms.
function findSeq(cx: Cx, from: number, to: number, seq: string): number {
  const { S } = cx;
  const A = atoms(cx);
  const k = memoScan(cx, `seq:${seq}`, from, (j) => {
    const c = S[j];
    if (c === '\\') return { next: j + 2 };
    if (c === '`') return { next: skipCode(cx, j) };
    if (A[j] > j) return { next: A[j] };
    if (S.startsWith(seq, j)) return { hit: j };
    return { next: j + 1 };
  });
  return k >= 0 && k + seq.length <= to ? k : -1;
}

// Tables for link parsing, built once per inline run on first use.
function linkTables(cx: Cx): Tables {
  if (cx.T) return cx.T;
  const { S } = cx;
  const n = S.length;
  // Bracket pairs, skipping escapes and code spans as inl() does.
  const match = new Int32Array(n).fill(-1);
  const stack: number[] = [];
  for (let j = 0; j < n;) {
    const c = S[j];
    if (c === '\\') { j += 2; continue; }
    if (c === '`') { j = skipCode(cx, j); continue; }
    if (c === '[') stack.push(j);
    else if (c === ']' && stack.length) match[stack.pop()!] = j;
    j++;
  }
  // Destination/title scanning: `\` + punctuation escapes one char.
  const escaped = new Uint8Array(n + 1);
  for (let j = 0; j < n; j++) {
    if (S[j] === '\\' && j + 1 < n && PUNCT_RE.test(S[j + 1])) { escaped[j + 1] = 1; j++; }
  }
  // P[j] = unescaped '(' minus ')' before j; a destination starting at k ends
  // at the first ')' taking P below P[k] (nextDrop), or at whitespace/control.
  const P = new Int32Array(n + 1);
  for (let j = 0; j < n; j++) {
    const v = escaped[j] ? 0 : S[j] === '(' ? 1 : S[j] === ')' ? -1 : 0;
    P[j + 1] = P[j] + v;
  }
  const nextDrop = new Int32Array(n + 1).fill(-1);
  const mono: number[] = [];
  for (let j = n; j >= 0; j--) {
    while (mono.length && P[mono[mono.length - 1]] >= P[j]) mono.pop();
    nextDrop[j] = mono.length ? mono[mono.length - 1] : -1;
    mono.push(j);
  }
  const nextStop = new Int32Array(n + 1);
  const nextNonWs = new Int32Array(n + 1);
  const nextQ = { '"': new Int32Array(n + 1), "'": new Int32Array(n + 1), ')': new Int32Array(n + 1) };
  nextStop[n] = n; nextNonWs[n] = n;
  for (const q of Object.values(nextQ)) q[n] = n;
  for (let j = n - 1; j >= 0; j--) {
    const c = S[j];
    nextStop[j] = c <= ' ' ? j : nextStop[j + 1];
    nextNonWs[j] = (c === ' ' || c === '\n') ? nextNonWs[j + 1] : j;
    for (const [qc, arr] of Object.entries(nextQ)) arr[j] = (c === qc && !escaped[j]) ? j : arr[j + 1];
  }
  cx.T = { match, P, nextDrop, nextStop, nextNonWs, nextQ };
  return cx.T;
}

const unescapePunct = (s: string) => s.replace(/\\([!-/:-@[-`{-~])/g, '$1');

function pushText(out: Inline[], v: string) {
  const last = out[out.length - 1];
  if (last && last.t === 'text') last.v += v;
  else out.push({ t: 'text', v });
}

function pushAll(out: Inline[], nodes: Inline[]) {
  for (const n of nodes) if (n.t === 'text') pushText(out, n.v); else out.push(n);
}

// A link destination: a listed citation, else an allowlisted URL, else no link at all (the label stays as text).
function target(cx: Cx, dest: string, label: Inline[]): Inline[] {
  const cite = cx.cites.get(dest);
  if (cite) return [citeNode(cite, label)];
  const href = safeHref(dest);
  return href ? [{ t: 'link', href, c: label }] : label;
}

function inl(from: number, to: number, cx: Cx, noLinks: boolean, depth: number): Inline[] {
  const { S } = cx;
  const A = atoms(cx);
  const out: Inline[] = [];
  let buf = '';
  const flush = () => { if (buf) { pushText(out, buf); buf = ''; } };
  let i = from;
  while (i < to) {
    const ae = A[i];
    if (ae > i && ae <= to) {
      const raw = S.slice(i, ae);
      // Inside a link label an atom is text: anchors never nest.
      if (noLinks) buf += raw;
      else { flush(); pushAll(out, target(cx, raw, [{ t: 'text', v: raw }])); }
      i = ae;
      continue;
    }

    const ch = S[i];
    if (ch === '\\' && i + 1 < to && PUNCT_RE.test(S[i + 1])) { buf += S[i + 1]; i += 2; continue; }
    if (ch === '\n') { flush(); out.push({ t: 'br' }); i++; continue; }

    if (ch === '`') {
      const n = runLen(S, i, to, '`');
      const cl = backtickClose(cx, i + n, to, n);
      if (cl >= 0) {
        flush();
        let v = S.slice(i + n, cl).replace(/\n/g, ' ');
        if (v.length >= 2 && v[0] === ' ' && v[v.length - 1] === ' ' && v.trim() !== '') v = v.slice(1, -1);
        out.push({ t: 'code', c: codeChildren(v, cx.cites) });
        i = cl + n;
      } else {
        buf += S.slice(i, i + n);
        i += n;
      }
      continue;
    }

    if (ch === '<' && !noLinks) {
      AUTO_RE.lastIndex = i;
      const m = AUTO_RE.exec(S);
      if (m && i + m[0].length <= to) {
        flush();
        pushAll(out, target(cx, m[1], [{ t: 'text', v: m[1] }]));
        i += m[0].length;
        continue;
      }
    }

    if (!noLinks && (ch === '[' || (ch === '!' && S[i + 1] === '['))) {
      const img = ch === '!';
      const r = mdLink(cx, img ? i + 1 : i, to);
      if (r) {
        flush();
        const label = inl(r.labelFrom, r.labelTo, cx, true, depth);
        pushAll(out, target(cx, r.href, img ? [{ t: 'text', v: plainText(label) }] : label));
        i = r.end;
        continue;
      }
      buf += ch;
      i++;
      continue;
    }

    if (ch === '*' || ch === '_' || ch === '~') {
      const r = depth < MAX_NESTING ? emphasis(cx, i, to, noLinks, depth) : null;
      if (r) { flush(); out.push(r.node); i = r.end; continue; }
      const n = runLen(S, i, to, ch);
      buf += S.slice(i, i + n);
      i += n;
      continue;
    }

    if (ch === '&') {
      const m = ENTITY_RE.exec(S.slice(i, i + 12));
      if (m) {
        if (m[3]) buf += NAMED[m[3]];
        else {
          const cp = m[1] ? Number(m[1]) : parseInt(m[2], 16);
          buf += (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) ? '�' : String.fromCodePoint(cp);
        }
        i += m[0].length;
        continue;
      }
    }

    buf += ch;
    i++;
  }
  flush();
  return out;
}

// [label](dest "title") starting at S[i] === '['. O(1) to reject, via linkTables;
// only an accepted link pays for slicing its destination. The title is parsed
// and dropped. Destinations are never entity-decoded.
function mdLink(cx: Cx, i: number, to: number): { labelFrom: number; labelTo: number; href: string; end: number } | null {
  const { S } = cx;
  const T = linkTables(cx);
  const labelTo = T.match[i];
  if (labelTo < 0 || labelTo + 1 >= to || S[labelTo + 1] !== '(') return null;
  let k = T.nextNonWs[labelTo + 2];
  if (k >= to) return null;
  let href: string;
  let e: number;
  if (S[k] === '<') {
    let j = k + 1;
    while (j < to && S[j] !== '>' && S[j] !== '<' && S[j] !== '\n') j += (S[j] === '\\' && PUNCT_RE.test(S[j + 1] ?? '')) ? 2 : 1;
    if (j >= to || S[j] !== '>') return null;
    href = unescapePunct(S.slice(k + 1, j));
    e = j + 1;
  } else {
    const drop = T.nextDrop[k];
    const close = drop >= 0 ? drop - 1 : Infinity;
    e = Math.min(T.nextStop[k], close, to);
    if (e !== close && T.P[e] !== T.P[k]) return null;
    href = unescapePunct(S.slice(k, e));
  }
  k = T.nextNonWs[e];
  const q = S[k];
  if (k > e && k < to && (q === '"' || q === "'" || q === '(')) {
    const close = T.nextQ[q === '(' ? ')' : q][k + 1];
    if (close >= to) return null;
    const after = T.nextNonWs[close + 1];
    if (after >= to || S[after] !== ')') return null;
    k = after;
  }
  if (k >= to || S[k] !== ')') return null;
  return { labelFrom: i + 1, labelTo, href, end: k + 1 };
}

// First acceptable closer for delimiter c×len at or after j: memoised per
// candidate, so rejected candidates are never re-examined by a later opener.
function closerFrom(cx: Cx, j: number, c: string, len: number): number {
  const { S } = cx;
  const delim = c.repeat(len);
  return memoScan(cx, `emph:${delim}`, j, (p) => {
    const k = findSeq(cx, p, S.length, delim);
    if (k < 0) return { hit: -1 };
    if (k !== p) return { next: k };
    if (len === 1 && S[k + 1] === c) return { next: k + runLen(S, k, S.length, c) };
    const after = S[k + len];
    const okPrev = !/\s/.test(S[k - 1]);
    const okAfter = c !== '_' || !(after && WORD_RE.test(after));
    return okPrev && okAfter ? { hit: k } : { next: k + 1 };
  });
}

function emphasis(cx: Cx, i: number, to: number, noLinks: boolean, depth: number): { node: Inline; end: number } | null {
  const { S } = cx;
  const c = S[i];
  let len: number;
  let kind: 'em' | 'strong' | 'del';
  if (c === '~') {
    if (S[i + 1] !== '~') return null;
    len = 2;
    kind = 'del';
  } else {
    len = S[i + 1] === c ? 2 : 1;
    kind = len === 2 ? 'strong' : 'em';
  }
  const open = i + len;
  if (open >= to || /\s/.test(S[open])) return null;
  if (c === '_' && i > 0 && WORD_RE.test(S[i - 1])) return null;
  let k = closerFrom(cx, open, c, len);
  if (k === open) k = closerFrom(cx, open + 1, c, len);
  if (k < 0 || k + len > to) return null;
  return { node: { t: kind, c: inl(open, k, cx, noLinks, depth + 1) }, end: k + len };
}
