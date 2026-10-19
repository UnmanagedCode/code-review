import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { Markdown, MarkdownBlocks } from './Markdown';

const cite = { raw: 'src/a.ts#L10-L20', path: 'src/a.ts', startLine: 10, endLine: 20 };

const TAGS = new Set(['div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'code', 'ul', 'ol', 'li', 'blockquote', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'br', 'em', 'strong', 'del', 'a']);
const HOSTILE = [
  '<img src=x onerror=alert(1)>', '<script>alert(1)</script>', '<iframe src="https://e.com"></iframe>', '<!-- c -->', '<a href="javascript:x" style="color:red">y</a>',
  '[a](javascript:alert(1))', '[b](JaVaScRiPt:alert(1))', '[c](java\tscript:alert(1))', '[d](\x01javascript:alert(1))',
  '[e](javascript&#58;alert(1))', '[f](&#106;avascript:alert(1))', '[g](data:text/html,<script>alert(1)</script>)', '[h](vbscript:x)',
  '[i](file:///etc/passwd)', '[j](//evil.com/x)', '[k](/pluginBridge.js)', '[l](foo/bar)', '[m](#frag)', '[n](?x=1)',
  '<javascript:alert(1)>', '<vbscript:x>', '<data:text/html,x>', '![img](https://e.com/y.png)', '![bad](javascript:x)',
  `[\`${cite.raw}\`](https://e.com/c)`,
].join('\n\n');
const CONSTRUCTS = [
  '# h1', '## h2', '### h3', '#### h4', '##### h5', '###### h6', 'para *em* **strong** ~~del~~ `code src/a.ts#L10-L20`\nline two',
  '```\nfenced <b>x</b>\n```', '3. one\n   - nested\n4. two', '- loose\n\n- list', '> quote\n> - in list', '---',
  '| l | c | r |\n|:--|:-:|--:|\n| 1 | 2 | 3 |', `see ${cite.raw}, [label](${cite.raw}), https://e.com/x and [m](mailto:a@b.c)`,
].join('\n\n');

// Invariant (DOM-level security boundary): a body yields only the renderer's tag set, no event-handler, style or src
// attribute, every href is either an in-app route or an allowlisted scheme, and no anchor nests in another.
test('emits only allowlisted tags and attributes', () => {
  const { container } = render(<Markdown body={`${CONSTRUCTS}\n\n${HOSTILE}`} citations={[cite]} />);
  const all = [...container.querySelectorAll('*')];
  for (const tag of ['h1', 'h6', 'pre', 'ol', 'blockquote', 'table', 'del', 'hr', 'br']) expect(container.querySelector(tag)).not.toBeNull();
  for (const el of all) {
    expect(TAGS).toContain(el.tagName.toLowerCase());
    for (const a of el.getAttributeNames()) {
      expect(a.startsWith('on')).toBe(false);
      expect(['style', 'src']).not.toContain(a);
    }
    const href = el.getAttribute('href');
    if (href !== null) expect(href.startsWith('?') || /^(https?:|mailto:)/.test(href)).toBe(true);
  }
  expect(container.querySelector('img, script, iframe')).toBeNull();
  expect(container.querySelector('a a')).toBeNull();
  expect(all.filter((el) => el.tagName === 'A').map((a) => a.getAttribute('href'))).toEqual([
    expect.stringMatching(/^\?/), expect.stringMatching(/^\?/), expect.stringMatching(/^\?/), 'https://e.com/x', 'mailto:a@b.c', 'https://e.com/', 'https://e.com/y.png', 'https://e.com/c',
  ]);
});

// Invariant: the renderer re-checks every link href itself, so an AST link with a refused href (from any producer)
// renders no anchor and keeps its label as text.
test('a link node with an unsafe href renders its label as text, no anchor', () => {
  const { container } = render(<MarkdownBlocks ast={[{ t: 'p', c: [{ t: 'link', href: 'javascript:alert(1)', c: [{ t: 'text', v: 'click' }] }] }]} />);
  expect(container.querySelector('a')).toBeNull();
  expect(container.textContent).toBe('click');
});

// Invariant: external links never get an opener handle or a referrer.
test('external links open in a new tab with noopener noreferrer', () => {
  render(<Markdown body="docs: https://example.com/a?b=1. and [x](https://e.com)" citations={[]} />);
  for (const a of screen.getAllByRole('link')) {
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toMatch(/noopener/);
    expect(a.getAttribute('rel')).toMatch(/noreferrer/);
  }
  expect(screen.getByRole('link', { name: 'https://example.com/a?b=1' }).getAttribute('href')).toBe('https://example.com/a?b=1');
});

// Invariant: a citation's href is built by the route serialiser, never copied from the body text.
test('a citation link’s href is built from the route and decodes to file= and lines=, not the raw text', () => {
  render(<Markdown body={`see ${cite.raw}`} citations={[cite]} />);
  const href = screen.getByRole('link', { name: cite.raw }).getAttribute('href')!;
  expect(href.startsWith('?')).toBe(true);
  const p = new URLSearchParams(href);
  expect(p.get('file')).toBe('src/a.ts');
  expect(p.get('lines')).toBe('10-20');
  expect(href).not.toBe(cite.raw);
});

// Invariant: a citation click navigates in-app (pushState) instead of loading a page.
test('clicking a citation navigates in-app (pushState) instead of loading a page', () => {
  const push = vi.spyOn(history, 'pushState');
  render(<Markdown body={`[the loop](${cite.raw})`} citations={[cite]} />);
  const notPrevented = fireEvent.click(screen.getByRole('link', { name: 'the loop' }));
  expect(notPrevented).toBe(false);
  expect(push).toHaveBeenCalled();
  expect(location.search).toContain('lines=10-20');
});

// Invariant: markup in a body is text, never elements.
test('markup in a body renders as literal text, never as elements', () => {
  const body = '<img src=x onerror=alert(1)><script>alert(2)</script>';
  const { container } = render(<Markdown body={body} citations={[]} />);
  expect(container.querySelector('img, script')).toBeNull();
  expect(container.textContent).toBe(body);
});
