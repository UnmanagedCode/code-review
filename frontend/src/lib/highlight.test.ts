import { expect, test, vi } from 'vitest';
import {
  HIGHLIGHT_LANGUAGES, HIGHLIGHT_MAX_LINE_CHARS, HIGHLIGHT_MAX_LINES, HIGHLIGHT_MAX_SIDE_CHARS, HIGHLIGHT_MAX_SIDE_CHARS_BY_LANG, highlightLines, languageFor, sideCharCap, TOKEN_CLASS,
} from './highlight';
import { tokenize } from './highlight/prism';

test('languageFor maps extensions and known basenames; anything else is plain', () => {
  // Invariant: a path maps to a Prism language only through the extension/basename tables; anything else renders plain.
  expect(languageFor('src/a.ts')).toBe('typescript');
  expect(languageFor('x/App.TSX')).toBe('tsx');
  expect(languageFor('a/b.py')).toBe('python');
  expect(languageFor('Dockerfile')).toBe('bash');
  for (const p of ['Makefile', 'notes.unknownext', 'README', '.gitignore']) expect(languageFor(p)).toBeNull();
});

test('real Prism: a keyword gets the keyword class; a multi-line comment splits into per-line segments', () => {
  // Invariant: real Prism output becomes per-line segments whose text round-trips, with classes only from TOKEN_CLASS.
  const lines = highlightLines('const a = 1; /* one\ntwo */ let b;', 'javascript', tokenize);
  expect(lines).toHaveLength(2);
  expect(lines[0].find((s) => s.text === 'const')?.cls).toBe(TOKEN_CLASS.keyword);
  expect(lines[0].at(-1)).toEqual({ text: '/* one', cls: TOKEN_CLASS.comment });
  expect(lines[1][0]).toEqual({ text: 'two */', cls: TOKEN_CLASS.comment });
  expect(lines.map((l) => l.map((s) => s.text).join(''))).toEqual(['const a = 1; /* one', 'two */ let b;']);
});

test('an unknown token type, including an Object.prototype key, gets no class; no language or tokenizer means plain text', () => {
  // Invariant: a token type outside TOKEN_CLASS never becomes a class; no language or tokenizer means plain text.
  const spy = vi.fn(() => ['a', { type: 'nonsense-type', content: 'b', alias: undefined, length: 1 } as never]);
  expect(highlightLines('ab', 'x', spy)).toEqual([[{ text: 'a', cls: null }, { text: 'b', cls: null }]]);
  expect(highlightLines('a\nb', null, spy)).toEqual([[{ text: 'a', cls: null }], [{ text: 'b', cls: null }]]);
  expect(highlightLines('a', 'x', null)).toEqual([[{ text: 'a', cls: null }]]);
  // A plain `in` or `TOKEN_CLASS[type]` lookup would hand these a function or an object as the class.
  const proto = ['constructor', 'toString', '__proto__', 'hasOwnProperty'];
  const tokens = vi.fn(() => proto.map((type) => ({ type, content: type, alias: undefined, length: type.length }) as never));
  expect(highlightLines(proto.join(''), 'x', tokens)).toEqual([proto.map((text) => ({ text, cls: null }))]);
});

test('bounds: past the line length, line count or side size cap the side is plain and the tokenizer is never called', () => {
  // Invariant: past any HIGHLIGHT_MAX_* cap the tokenizer is never called and the side renders plain.
  const over = [
    'x'.repeat(HIGHLIGHT_MAX_LINE_CHARS + 1),
    Array.from({ length: HIGHLIGHT_MAX_LINES + 1 }, () => 'x').join('\n'),
    // Short lines within both other caps, but more characters in total than the side cap.
    Array.from({ length: HIGHLIGHT_MAX_LINES }, () => 'y'.repeat(Math.ceil(HIGHLIGHT_MAX_SIDE_CHARS / HIGHLIGHT_MAX_LINES) + 1)).join('\n'),
  ];
  for (const text of over) {
    const spy = vi.fn(() => [text]);
    const out = highlightLines(text, 'javascript', spy);
    expect(spy).not.toHaveBeenCalled();
    expect(out.every((l) => l.length === 1 && l[0].cls === null)).toBe(true);
    expect(out.map((l) => l[0].text).join('\n')).toBe(text);
  }
  expect(Math.ceil(HIGHLIGHT_MAX_SIDE_CHARS / HIGHLIGHT_MAX_LINES) + 1).toBeLessThanOrEqual(HIGHLIGHT_MAX_LINE_CHARS);
  const under = Array.from({ length: HIGHLIGHT_MAX_LINES }, (_, i) => (i === 0 ? 'z'.repeat(HIGHLIGHT_MAX_LINE_CHARS) : 'z')).join('\n');
  expect(under.length).toBeLessThanOrEqual(HIGHLIGHT_MAX_SIDE_CHARS);
  const spy = vi.fn((t: string) => [t]);
  highlightLines(under, 'javascript', spy);
  expect(spy).toHaveBeenCalledTimes(1);
});

/** A side of exactly `n` characters in 199-character lines (within the line-length and line-count caps). */
const sideOf = (n: number) => Array.from({ length: Math.ceil(n / 200) }, () => 'y'.repeat(199)).join('\n').slice(0, n);

test('a side over its language\'s cap is plain and never tokenized; at the cap it is tokenized', () => {
  // Invariant: no language is tokenized past its HIGHLIGHT_MAX_SIDE_CHARS_BY_LANG cap (else HIGHLIGHT_MAX_SIDE_CHARS), the
  // bound that keeps a quadratic grammar's worst case short (harness/bench/highlight.mjs).
  for (const lang of HIGHLIGHT_LANGUAGES) {
    const cap = sideCharCap(lang);
    expect(cap).toBe(HIGHLIGHT_MAX_SIDE_CHARS_BY_LANG[lang] ?? HIGHLIGHT_MAX_SIDE_CHARS);
    const over = vi.fn((t: string) => [t]);
    const text = sideOf(cap + 1);
    expect(highlightLines(text, lang, over).flat().every((seg) => seg.cls === null)).toBe(true);
    expect(over).not.toHaveBeenCalled();
    const at = vi.fn((t: string) => [t]);
    highlightLines(sideOf(cap), lang, at);
    expect(at).toHaveBeenCalledTimes(1);
  }
});

test('the per-language caps name only languages languageFor returns, and only lower the global cap', () => {
  // Invariant: the table can't silently miss a language through a typo, or raise a cap above HIGHLIGHT_MAX_SIDE_CHARS.
  for (const [lang, cap] of Object.entries(HIGHLIGHT_MAX_SIDE_CHARS_BY_LANG)) {
    expect(HIGHLIGHT_LANGUAGES).toContain(lang);
    expect(cap).toBeLessThan(HIGHLIGHT_MAX_SIDE_CHARS);
  }
});
