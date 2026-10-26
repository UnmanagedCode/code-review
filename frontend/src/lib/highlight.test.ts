import { expect, test, vi } from 'vitest';
import { HIGHLIGHT_MAX_LINE_CHARS, HIGHLIGHT_MAX_LINES, HIGHLIGHT_MAX_SIDE_CHARS, highlightLines, languageFor, TOKEN_CLASS } from './highlight';
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

test('an unknown token type gets no class, and no language or tokenizer means plain text', () => {
  // Invariant: a token type outside TOKEN_CLASS never becomes a class; no language or tokenizer means plain text.
  const spy = vi.fn(() => ['a', { type: 'nonsense-type', content: 'b', alias: undefined, length: 1 } as never]);
  expect(highlightLines('ab', 'x', spy)).toEqual([[{ text: 'a', cls: null }, { text: 'b', cls: null }]]);
  expect(highlightLines('a\nb', null, spy)).toEqual([[{ text: 'a', cls: null }], [{ text: 'b', cls: null }]]);
  expect(highlightLines('a', 'x', null)).toEqual([[{ text: 'a', cls: null }]]);
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
