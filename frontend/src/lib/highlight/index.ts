import type { PrismToken } from './prism';

/** One run of text with at most one token class. */
export interface Seg { text: string; cls: string | null }

export type Tokenize = (text: string, lang: string) => PrismToken[];

/** Past any of these, a file side renders plain and the tokenizer is not called. */
export const HIGHLIGHT_MAX_LINE_CHARS = 2000;
export const HIGHLIGHT_MAX_LINES = 5000;
export const HIGHLIGHT_MAX_SIDE_CHARS = 1_000_000;

/**
 * Prism token type → a class. A type not listed gets its enclosing token's class, or none. The `token-*` colours are
 * contrast-safe on every diff row tint (`--cr-token-*` in index.css).
 */
export const TOKEN_CLASS: Record<string, string> = {
  keyword: 'text-token-keyword',
  string: 'text-token-string',
  char: 'text-token-string',
  number: 'text-token-number',
  boolean: 'text-token-number',
  constant: 'text-token-number',
  comment: 'text-token-comment italic',
  prolog: 'text-token-comment italic',
  function: 'text-token-function',
  'class-name': 'text-token-function',
  tag: 'text-token-tag',
  'attr-name': 'text-token-tag',
};

const EXT: Record<string, string> = {
  html: 'markup', htm: 'markup', xml: 'markup', svg: 'markup', vue: 'markup',
  css: 'css', scss: 'css', less: 'css',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx', ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx',
  json: 'json', jsonc: 'json',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  py: 'python', go: 'go', rs: 'rust', java: 'java',
  c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', cs: 'csharp',
  rb: 'ruby', php: 'php', yml: 'yaml', yaml: 'yaml', md: 'markdown', markdown: 'markdown', sql: 'sql', diff: 'diff', patch: 'diff',
};
const BASENAME: Record<string, string> = { Dockerfile: 'bash', Gemfile: 'ruby', Rakefile: 'ruby', '.bashrc': 'bash', '.zshrc': 'bash' };
/** Every language `languageFor` can return. */
export const HIGHLIGHT_LANGUAGES = [...new Set([...Object.values(EXT), ...Object.values(BASENAME)])];

/**
 * Per-language side caps below HIGHLIGHT_MAX_SIDE_CHARS. Prism's greedy patterns go quadratic on lines of unterminated
 * literals, so each keeps the worst stress input of `harness/bench/highlight.mjs` within about 150 ms per side (its README
 * has the numbers). A language not listed takes HIGHLIGHT_MAX_SIDE_CHARS.
 */
export const HIGHLIGHT_MAX_SIDE_CHARS_BY_LANG: Partial<Record<string, number>> = {
  markup: 250_000, rust: 250_000, ruby: 250_000, yaml: 250_000,
  sql: 128_000,
  json: 96_000, python: 96_000,
  go: 64_000, java: 64_000,
  javascript: 48_000, typescript: 48_000, c: 48_000,
  jsx: 32_000, tsx: 32_000, cpp: 32_000, csharp: 32_000,
  bash: 16_000, php: 16_000,
  css: 8_000, markdown: 8_000,
};

/** The most characters one side of `lang` may have and still be highlighted. */
export const sideCharCap = (lang: string): number =>
  (Object.hasOwn(HIGHLIGHT_MAX_SIDE_CHARS_BY_LANG, lang) ? HIGHLIGHT_MAX_SIDE_CHARS_BY_LANG[lang] : undefined) ?? HIGHLIGHT_MAX_SIDE_CHARS;

/** The Prism language for a path, or null (render plain). */
export function languageFor(path: string): string | null {
  const base = path.slice(path.lastIndexOf('/') + 1);
  if (Object.hasOwn(BASENAME, base)) return BASENAME[base];
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return null;
  const ext = base.slice(dot + 1).toLowerCase();
  return Object.hasOwn(EXT, ext) ? EXT[ext] : null;
}

const plain = (lines: string[]) => ({ lines: lines.map((text): Seg[] => [{ text, cls: null }]), tokenized: false });

/**
 * `text` (one file side) as segments per line, and whether `tokenize` ran. Plain — without calling `tokenize` — when
 * there is no language or tokenizer, or the side passes a cap (HIGHLIGHT_MAX_LINE_CHARS, HIGHLIGHT_MAX_LINES,
 * `sideCharCap`).
 */
export function highlightLines(text: string, lang: string | null, tokenize: Tokenize | null): { lines: Seg[][]; tokenized: boolean } {
  const lines = text.split('\n');
  if (!lang || !tokenize || text.length > sideCharCap(lang) || lines.length > HIGHLIGHT_MAX_LINES
    || lines.some((l) => l.length > HIGHLIGHT_MAX_LINE_CHARS)) return plain(lines);
  const out: Seg[][] = [[]];
  const emit = (s: string, cls: string | null) => {
    s.split('\n').forEach((part, i) => {
      if (i > 0) out.push([]);
      if (part) out.at(-1)!.push({ text: part, cls });
    });
  };
  const walk = (tokens: PrismToken[], cls: string | null) => {
    for (const t of tokens) {
      if (typeof t === 'string') { emit(t, cls); continue; }
      const own = Object.hasOwn(TOKEN_CLASS, t.type) ? TOKEN_CLASS[t.type] : cls;
      if (typeof t.content === 'string') emit(t.content, own);
      else walk(Array.isArray(t.content) ? t.content : [t.content], own);
    }
  };
  walk(tokenize(text, lang), null);
  return { lines: out, tokenized: true };
}
