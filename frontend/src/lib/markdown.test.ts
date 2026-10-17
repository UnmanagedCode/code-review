import { expect, test } from 'vitest';
import { MAX_NESTING, parseMarkdown, type Block, type Inline, type Text } from './markdown';
import type { Citation } from './types';

const cite = (raw: string, path: string, startLine: number, endLine = startLine): Citation => ({ raw, path, startLine, endLine });
const t = (v: string): Text => ({ t: 'text', v });

type Node = Block | Inline;
/** Every node in the tree, depth-first. */
function nodes(blocks: Block[]): Node[] {
  const out: Node[] = [];
  const visit = (n: unknown) => {
    if (Array.isArray(n)) { n.forEach(visit); return; }
    if (!n || typeof n !== 'object') return;
    out.push(n as Node);
    for (const k of ['c', 'items', 'head', 'rows'] as const) if (k in n) visit((n as Record<string, unknown>)[k]);
  };
  visit(blocks);
  return out;
}
const kinds = (blocks: Block[]) => nodes(blocks).map((n) => n.t);
const text = (blocks: Block[]) => nodes(blocks).map((n) => (n.t === 'text' ? n.v : n.t === 'pre' ? n.text : '')).join('');
/** The only paragraph's inlines. */
const para = (src: string, cites: Citation[] = []) => {
  const b = parseMarkdown(src, cites);
  expect(b).toHaveLength(1);
  return (b[0] as { c: Inline[] }).c;
};

// Invariant: each supported construct yields its node type, with the shape the renderer maps.
test.each<[string, string, Block[]]>([
  ['paragraph, single newline as br', 'a\nb', [{ t: 'p', c: [t('a'), { t: 'br' }, t('b')] }]],
  ['h1–h6', '# a\n## b\n### c\n#### d\n##### e\n###### f',
    ['a', 'b', 'c', 'd', 'e', 'f'].map((v, i) => ({ t: 'h', level: i + 1, c: [t(v)] }) as Block)],
  ['em, strong, del', '*a* _b_ **c** ~~d~~', [{ t: 'p', c: [
    { t: 'em', c: [t('a')] }, t(' '), { t: 'em', c: [t('b')] }, t(' '), { t: 'strong', c: [t('c')] }, t(' '), { t: 'del', c: [t('d')] },
  ] }]],
  ['inline code', 'x `y` z', [{ t: 'p', c: [t('x '), { t: 'code', c: [t('y')] }, t(' z')] }]],
  ['fenced block, verbatim', '```js\n<b>x</b>\n  *y*\n```', [{ t: 'pre', text: '<b>x</b>\n  *y*' }]],
  ['ul nested in ol with start', '3. a\n   - b\n4. c', [{ t: 'ol', start: 3, tight: true, items: [
    [{ t: 'p', c: [t('a')] }, { t: 'ul', tight: true, items: [[{ t: 'p', c: [t('b')] }]] }],
    [{ t: 'p', c: [t('c')] }],
  ] }]],
  ['tight list', '- a\n- b', [{ t: 'ul', tight: true, items: [[{ t: 'p', c: [t('a')] }], [{ t: 'p', c: [t('b')] }]] }]],
  ['loose list', '- a\n\n- b', [{ t: 'ul', tight: false, items: [[{ t: 'p', c: [t('a')] }], [{ t: 'p', c: [t('b')] }]] }]],
  ['blockquote holding a list', '> - a\n> - b', [{ t: 'quote', c: [{ t: 'ul', tight: true, items: [[{ t: 'p', c: [t('a')] }], [{ t: 'p', c: [t('b')] }]] }] }]],
  ['link', '[x](https://e.com/a)', [{ t: 'p', c: [{ t: 'link', href: 'https://e.com/a', c: [t('x')] }] }]],
  ['hr', 'a\n\n---\n\nb', [{ t: 'p', c: [t('a')] }, { t: 'hr' }, { t: 'p', c: [t('b')] }]],
  ['pipe table with alignment', '| a | b | c | d |\n|:--|:-:|--:|---|\n| 1 | **2** | 3 | 4 |', [{
    t: 'table', align: ['left', 'center', 'right', null],
    head: [[t('a')], [t('b')], [t('c')], [t('d')]],
    rows: [[[t('1')], [{ t: 'strong', c: [t('2')] }], [t('3')], [t('4')]]],
  }]],
])('parses each supported construct: %s', (_name, src, ast) => {
  expect(parseMarkdown(src, [])).toEqual(ast);
});

// Invariant: emphasis never splits a server-listed citation; the citation is one atom.
test('a citation stays one atom: src/__init__.py#L3 is a cite, not strong', () => {
  const c = cite('src/__init__.py#L3', 'src/__init__.py', 3);
  expect(para('see src/__init__.py#L3 now', [c])).toEqual([
    t('see '), { t: 'cite', path: 'src/__init__.py', start: 3, end: 3, c: [t('src/__init__.py#L3')] }, t(' now'),
  ]);
  // Emphasis around the atom still pairs, across it.
  expect(para('**a.ts#L1-L2**', [cite('a.ts#L1-L2', 'a.ts', 1, 2)])).toEqual([
    { t: 'strong', c: [{ t: 'cite', path: 'a.ts', start: 1, end: 2, c: [t('a.ts#L1-L2')] }] },
  ]);
});

// Invariant: an emphasis opener outside an atom never pairs with a closer inside one.
// (Each closer below is acceptable on its own: only skipping the atom keeps the opener unpaired.)
test.each<[string, string, Citation[], Inline[]]>([
  ['citation', '_x a_.ts#L1', [cite('a_.ts#L1', 'a_.ts', 1)], [t('_x '), { t: 'cite', path: 'a_.ts', start: 1, end: 1, c: [t('a_.ts#L1')] }]],
  ['bare URL', '*a https://e.com/x*y', [], [t('*a '), { t: 'link', href: 'https://e.com/x*y', c: [t('https://e.com/x*y')] }]],
])('an emphasis opener never closes inside a %s atom', (_name, src, cites, inlines) => {
  expect(para(src, cites)).toEqual(inlines);
});

const link = (href: string, label: string | Inline[]): Inline => ({ t: 'link', href, c: typeof label === 'string' ? [t(label)] : label });

// Invariant: a bare-URL atom inside a link destination never runs past the destination's closing `)`, so emphasis
// delimiters right after the link still pair (escaped and nested parens counted as the destination counts them).
test.each<[string, Inline[]]>([
  ['**[x](https://q.com)**x', [{ t: 'strong', c: [link('https://q.com/', 'x')] }, t('x')]],
  ['*[x](https://q.com)*:-:)', [{ t: 'em', c: [link('https://q.com/', 'x')] }, t(':-:)')]],
  ['**[x](https://q.com/(a))**x', [{ t: 'strong', c: [link('https://q.com/(a)', 'x')] }, t('x')]],
  ['**[x](https://q.com/a\\(b)**x', [{ t: 'strong', c: [link('https://q.com/a(b', 'x')] }, t('x')]],
])('a URL in a link destination never swallows a delimiter after the link: %s', (src, inlines) => {
  expect(para(src)).toEqual(inlines);
});

// Invariant: brackets end a bare URL, so it never swallows a markdown link that follows it.
test('a bare URL stops at a bracket: a following markdown link stays its own link', () => {
  expect(para('see https://a.com/[x](https://b.com) end')).toEqual([
    t('see '), link('https://a.com/', 'https://a.com/'), link('https://b.com/', 'x'), t(' end'),
  ]);
});

// Invariant: a bare URL keeps a trailing `)` that closes its own `(` and drops one that closes text outside it (GFM).
test('a bare URL keeps a balanced trailing paren and drops an unbalanced one', () => {
  expect(para('see (https://e.com/a_(b)).')).toEqual([t('see ('), link('https://e.com/a_(b)', 'https://e.com/a_(b)'), t(').')]);
  expect(para('(https://e.com/a_(b)c))')).toEqual([t('('), link('https://e.com/a_(b)c', 'https://e.com/a_(b)c'), t('))')]);
});

// Invariant: the server's list decides what is a citation; the parser only finds its extent.
test('a citation not in the server\'s list stays text', () => {
  expect(para('see a.ts#L3')).toEqual([t('see a.ts#L3')]);
  // Mid-run text is never a citation start, even when a listed raw matches it.
  expect(para('xa.ts#L3', [cite('a.ts#L3', 'a.ts', 3)])).toEqual([t('xa.ts#L3')]);
});

// Invariant: unsafe paths (absolute, `..`) are never linked, as in the backend's resolver.
test('absolute and .. citation paths stay text', () => {
  const body = 'x ../x#L1 and /etc/x#L1 and [l](../x#L1)';
  const b = parseMarkdown(body, [cite('../x#L1', '../x', 1), cite('/etc/x#L1', '/etc/x', 1)]);
  expect(kinds(b)).not.toContain('cite');
  expect(kinds(b)).not.toContain('link');
});

// Invariant: a repeated listed citation links every time.
test('a listed citation repeated in the body is a cite each time', () => {
  expect(kinds(parseMarkdown('a.ts#L2 then a.ts#L2', [cite('a.ts#L2', 'a.ts', 2)])).filter((k) => k === 'cite')).toHaveLength(2);
});

// Invariant: citations link inside inline code; nothing links inside a fenced block.
test('a citation inside inline code is a cite inside code; inside a fenced block it is text', () => {
  const c = [cite('src/a.ts#L3', 'src/a.ts', 3)];
  expect(para('`see src/a.ts#L3`', c)).toEqual([
    { t: 'code', c: [t('see '), { t: 'cite', path: 'src/a.ts', start: 3, end: 3, c: [t('src/a.ts#L3')] }] },
  ]);
  expect(parseMarkdown('```\nsrc/a.ts#L3 https://e.com\n```', c)).toEqual([{ t: 'pre', text: 'src/a.ts#L3 https://e.com' }]);
  expect(kinds(parseMarkdown('`https://e.com`', c))).toEqual(['p', 'code', 'text']);
});

// Invariant: a markdown link whose destination is a listed citation is the in-app citation, with the label as children.
test('[label](src/a.ts#L1-L3) naming a listed citation becomes a cite with that label', () => {
  expect(para('[the *loop*](src/a.ts#L1-L3)', [cite('src/a.ts#L1-L3', 'src/a.ts', 1, 3)])).toEqual([
    { t: 'cite', path: 'src/a.ts', start: 1, end: 3, c: [t('the '), { t: 'em', c: [t('loop')] }] },
  ]);
});

// Invariant: a bare URL is one atom: trailing punctuation is trimmed and its `_`/`*` are not emphasis.
test('a bare https URL is a link with trailing punctuation trimmed; underscores/asterisks inside it are not emphasis', () => {
  expect(para('docs: https://e.com/a_b_c*d*?q=1.')).toEqual([
    t('docs: '), { t: 'link', href: 'https://e.com/a_b_c*d*?q=1', c: [t('https://e.com/a_b_c*d*?q=1')] }, t('.'),
  ]);
  expect(para('(https://e.com/x)')).toEqual([t('('), { t: 'link', href: 'https://e.com/x', c: [t('https://e.com/x')] }, t(')')]);
  expect(para('_https://e.com/a_b_')).toEqual([{ t: 'em', c: [{ t: 'link', href: 'https://e.com/a_b', c: [t('https://e.com/a_b')] }] }]);
});

// Invariant: anchors never nest: a URL or citation inside a link label is text.
test('a URL inside a link label is text, not a nested link', () => {
  const c = [cite('a.ts#L1', 'a.ts', 1)];
  expect(para('[see https://a.com and a.ts#L1](https://b.com)', c)).toEqual([
    { t: 'link', href: 'https://b.com/', c: [t('see https://a.com and a.ts#L1')] },
  ]);
});

// Invariant: no HTML passthrough: raw HTML (comments included) is literal text.
test.each(['<img src=x onerror=alert(1)>', '<script>alert(1)</script>', '<!-- c -->', '<a href="javascript:x">y</a>'])('raw HTML is text: %s', (src) => {
  expect(para(src)).toEqual([t(src)]);
});

// Invariant: only http:, https:, mailto: and listed citations link; obfuscated schemes are refused on the parsed protocol.
test.each([
  'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', '\x01javascript:alert(1)',
  'javascript&#58;alert(1)', '&#106;avascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x',
  'file:///etc/passwd', '//evil.com/x', '/pluginBridge.js', 'foo/bar', '#frag', '?x=1',
])('rejects every non-allowlisted destination: %j', (dest) => {
  for (const src of [`[label](${dest})`, `<${dest}>`]) {
    const b = parseMarkdown(src, []);
    expect(kinds(b)).not.toContain('link');
    expect(kinds(b)).not.toContain('cite');
    expect(text(b)).toContain(src.startsWith('[') ? 'label' : dest.slice(-3));
  }
});

// Invariant: allowlisted links carry the normalised href (`safeHref`), never the raw text.
test('allows http, https, mailto and normalises the href', () => {
  const hrefs = (src: string) => nodes(parseMarkdown(src, [])).flatMap((n) => (n.t === 'link' ? [n.href] : []));
  expect(hrefs('[a](HTTPS://E.com) [b](http://e.com/x%20y) [c](mailto:a@b.c) <https://e.com/q?x=1> <mailto:x@y.z>')).toEqual([
    'https://e.com/', 'http://e.com/x%20y', 'mailto:a@b.c', 'https://e.com/q?x=1', 'mailto:x@y.z',
  ]);
});

// Invariant: images never load: an image is a link labelled by its alt, or text when its target is refused.
test('images never load: ![alt](https://x/y.png) is a link labelled alt; ![alt](javascript:x) is text', () => {
  expect(para('![the *alt*](https://x/y.png)')).toEqual([{ t: 'link', href: 'https://x/y.png', c: [t('the alt')] }]);
  expect(para('![alt](javascript:x)')).toEqual([t('alt')]);
});

const timed = (src: string) => {
  const t0 = performance.now();
  parseMarkdown(src, [cite('a.ts#L1', 'a.ts', 1)]);
  return performance.now() - t0;
};
const N = 100_000;
const rep = (s: string, extra = '') => s.repeat(Math.ceil(N / s.length)) + extra;
const sp = (n: number) => ' '.repeat(n);

// Invariant: parsing is amortized linear: no unmatched delimiter or failed atom rescans the rest of the input (no ReDoS).
test.each(Object.entries({
  '*a': rep('*a'),
  '_a': rep('_a'),
  '**': rep('**'),
  '[': rep('['),
  '[x](a (': rep('[x](a (', `)${sp(1000)}`),
  'backtick runs of distinct lengths': Array.from({ length: 440 }, (_, i) => `${'`'.repeat(i + 1)}a`).join(''),
  'unlisted citation-like run': rep('a/', '#Lx'),
  'unlisted citation-like runs': rep('a/b#L1 '),
  'URL then a punctuation tail': `https://a/${'.'.repeat(N)}`,
  'failed URL candidates': rep('http://%'),
  'URLs in unclosed parens': rep('https://a/('),
  'URLs cut by unbalanced parens': rep('https://a/)'),
  '<': rep('<'),
  '&#': rep('&#'),
  '|-heavy table rows': `a|b\n-|-\n${rep('|')}\n${rep('|')}`,
  'spaces around pipes in a delimiter row': `|\n${sp(N / 2)}|${sp(N / 2)}`,
}))('pathological input parses in under 1 s each: %s', (_name, src) => {
  expect(timed(src)).toBeLessThan(1000);
});

/** Depth of the deepest nested block/inline chain. */
function depth(blocks: Block[]): number {
  let max = 0;
  const visit = (n: unknown, d: number) => {
    if (Array.isArray(n)) { n.forEach((x) => visit(x, d)); return; }
    if (!n || typeof n !== 'object') return;
    max = Math.max(max, d);
    for (const k of ['c', 'items', 'head', 'rows']) if (k in n) visit((n as Record<string, unknown>)[k], d + 1);
  };
  visit(blocks, 0);
  return max;
}

// Invariant: nesting is capped at MAX_NESTING: no stack overflow or hang, and the content survives as text.
test.each(Object.entries({
  quotes: `${'>'.repeat(100_000)} x`,
  'nested list levels on one line': `${'- '.repeat(5000)}x`,
  // ~100k chars: the indent grows by 2 per level.
  'nested list levels one per line': Array.from({ length: 316 }, (_, i) => `${sp(2 * i)}- x`).join('\n'),
  emphasis: `${'*'.repeat(10_000)}x${'*'.repeat(10_000)}`,
}))('deep nesting is capped, not recursive without bound: %s', (_name, src) => {
  const t0 = performance.now();
  const b = parseMarkdown(src, []);
  expect(performance.now() - t0).toBeLessThan(1000);
  expect(depth(b)).toBeLessThanOrEqual(MAX_NESTING + 4);
  expect(text(b)).toContain('x');
});
