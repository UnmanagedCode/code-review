import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { App } from './App';
import { parseRoute } from './lib/route';
import { TOKEN_CLASS } from './lib/highlight';
import { installFakeEventSource } from './test/fakeEventSource';
import { refusal } from './test/fixtures';
import { stubFetch } from './test/stubFetch';

const src = path.dirname(fileURLToPath(import.meta.url));
const frontend = path.dirname(src);

/** Every .ts, .tsx, .js, .jsx, .mjs and .html file under frontend/ (public scripts and index.html included), minus dist/, node_modules/, test/ dirs and *.test.* files. CSS is not scanned. */
function frontendSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return ['dist', 'node_modules', 'test'].includes(name) ? [] : frontendSources(p);
    return /\.(tsx?|jsx?|mjs|html)$/.test(name) && !/\.test\./.test(name) ? [p] : [];
  });
}
const all = frontendSources(frontend);
const offenders = (re: RegExp, files = all) => files.filter((f) => re.test(readFileSync(f, 'utf8'))).map((f) => path.relative(frontend, f));

test('with no checkout chosen, App offers the project picker', async () => {
  stubFetch({ 'GET api/projects': { projects: [{ name: 'app' }] } });
  render(<App />);
  expect(await screen.findByText('Choose a project to review')).toBeTruthy();
  expect(await screen.findByRole('option', { name: 'app' })).toBeTruthy();
});

const HEAD = 'e'.repeat(40);
/** `app` at HEAD with fork point `main`; `api/checkout/commit` knows HEAD, main and `old`. */
function linkWorld() {
  installFakeEventSource();
  const commit = (sha: string, subject: string) => ({ sha, short: sha.slice(0, 7), author: 'a', date: 'd', subject, merge: false });
  const refs: Record<string, ReturnType<typeof commit>> = { HEAD: commit(HEAD, 'tip'), main: commit('f'.repeat(40), 'fork'), old: commit('0'.repeat(40), 'ancient') };
  return stubFetch([
    [/^GET api\/projects$/, { projects: [{ name: 'app' }] }],
    [/^GET api\/checkout\?/, { checkout: { project: 'app', worktree: null, path: '/x', branch: 'main', headSha: HEAD, dirty: false, exists: true }, forkPoints: [{ ref: 'main', label: 'main (parent)', forkSha: 'f'.repeat(40) }], worktrees: [] }],
    [/^GET api\/checkout\/commits\?/, { commits: [] }],
    [/^GET api\/checkout\/commit\?/, (u: URL) => refs[u.searchParams.get('ref')!] ? { commit: refs[u.searchParams.get('ref')!] } : refusal('REF_UNKNOWN', 404)],
    [/^GET api\/sessions/, { sessions: [] }],
    [/^GET api\/reviews\?/, { reviews: [] }],
  ]);
}
const radio = (name: RegExp | string) => screen.getByRole('radio', { name }).getAttribute('aria-checked');

// Invariant: a contract link (`view=new&range=…`) opens the New review dialog with that prefill applied.
test('a view=new link with a range opens the prefilled New review dialog', async () => {
  linkWorld();
  history.replaceState(null, '', '?project=app&view=new&range=old...HEAD');
  render(<App />);
  await screen.findByRole('dialog', { name: 'New review' });
  await waitFor(() => expect(radio('Another commit')).toBe('true'));
});

// Invariant: closing the dialog drops its prefill, so reopening New review starts from the defaults.
test('Cancel closes the dialog and clears view, range and sha', async () => {
  linkWorld();
  history.replaceState(null, '', '?project=app&view=new&range=old...HEAD');
  render(<App />);
  await screen.findByRole('dialog', { name: 'New review' });
  await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel' }));
  expect(parseRoute(location.search)).toEqual({ project: 'app' });
  expect(screen.queryByRole('dialog')).toBeNull();
});

// Invariant: cc steering an open frame to another link applies that link's prefill, not the first one's.
test('a popstate steer to another range remounts the dialog with the new prefill', async () => {
  linkWorld();
  history.replaceState(null, '', '?project=app&view=new&range=old...HEAD');
  render(<App />);
  await waitFor(() => expect(radio('Another commit')).toBe('true'));
  act(() => {
    history.replaceState(null, '', '?project=app&view=new&range=main...HEAD');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await waitFor(() => expect(radio(/main \(parent\)/)).toBe('true'));
  expect(radio('Another commit')).toBe('false');
});

// Content must reach the DOM as text, never markup: a model reply rendered raw is script with cc's API.
// This scan is a backstop over literal source text, not a security boundary.
test('UI source uses no raw-markup or dynamic-code escape hatch', () => {
  const banned = /dangerouslySetInnerHTML|\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(|setHTMLUnsafe|parseHTMLUnsafe|createContextualFragment|DOMParser/;
  expect(offenders(banned)).toEqual([]);
});

test('the source-text guards actually see the sources it is meant to cover', () => {
  const seen = all.map((f) => path.relative(frontend, f));
  expect(seen.length).toBeGreaterThan(30);
  for (const must of ['src/App.tsx', 'index.html', 'public/theme-init.js', 'src/features/diff/FileDiff.tsx', 'src/state/submit.ts', 'src/lib/route.ts', 'src/components/ui/button.tsx',
    'src/lib/splitRows.ts', 'src/features/diff/SplitRow.tsx', 'src/features/diff/SettledThread.tsx', 'src/features/diff/HunkHeader.tsx', 'src/features/layout/ResizeHandle.tsx',
    'src/lib/highlight/prism.ts', 'src/features/diff/CodeLine.tsx']) expect(seen).toContain(must);
  expect(seen.some((f) => f.startsWith('dist') || f.includes('node_modules'))).toBe(false);
});

// Prism's token tree is data; its markup builders (and auto-highlighting, off via prismManual.ts) write HTML. The only
// sanitisation boundary is highlightLines → CodeLine's React text, so prismjs stays behind lib/highlight/prism.ts.
const PRISM_IMPORT = /(?:\bfrom|\bimport\s*\(?|\brequire\s*\()\s*(['"`])prismjs(?:\/[^'"`]*)?\1/;
const MARKUP_BUILDER = /\.highlight(?:Element|All|AllUnder)?\s*\(|\.stringify\s*\(/;
const withoutComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const codeOffenders = (re: RegExp, files = all) => files.filter((f) => re.test(withoutComments(readFileSync(f, 'utf8')))).map((f) => path.relative(frontend, f));
test('prismjs is imported only by lib/highlight/prism.ts, and Prism\'s markup builders are never referenced', () => {
  // The patterns catch every import form and quote style, and ignore commented-out code.
  for (const form of ["import Prism from 'prismjs';", 'import Prism from "prismjs";', "import 'prismjs/components/prism-go';", 'import "prismjs";',
    "await import('prismjs')", 'import("prismjs")', 'import(`prismjs`)', "require('prismjs')", 'require("prismjs/components/x")', "export { x } from 'prismjs';"]) {
    expect(PRISM_IMPORT.test(withoutComments(form)), form).toBe(true);
  }
  for (const not of ["// import 'prismjs';", "/* require('prismjs') */", "import x from 'prismjs-extra';", "const url = 'https://x/'; // import 'prismjs'"]) {
    expect(PRISM_IMPORT.test(withoutComments(not)), not).toBe(false);
  }
  expect(['Prism.highlight(a)', 'Prism.highlightAll()', 'el.highlightElement (x)', 'Token.stringify(t)'].every((c) => MARKUP_BUILDER.test(c))).toBe(true);
  expect(codeOffenders(PRISM_IMPORT)).toEqual([path.join('src', 'lib', 'highlight', 'prism.ts')]);
  expect(codeOffenders(MARKUP_BUILDER, all.filter((f) => f.includes(path.join('src', 'lib', 'highlight'))))).toEqual([]);
});

test('UI source never assigns location.hash', () => {
  expect(offenders(/location\.hash\s*=[^=]/)).toEqual([]);
});

test('localStorage is used only by lib/storage.ts', () => {
  expect(offenders(/localStorage/)).toEqual([path.join('src', 'lib', 'storage.ts')]);
});

test('no root-relative fetch or EventSource URL (it would reach cc, not this plugin)', () => {
  expect(offenders(/(?:fetch|EventSource)\(\s*['"`]\//)).toEqual([]);
});

test('colours come from tokens: no literal colours and no Tailwind palette colour classes', () => {
  const tsx = all;
  expect(offenders(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/, tsx)).toEqual([]);
  const palette = '(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)';
  expect(offenders(new RegExp(`\\b(?:bg|text|border|ring|fill|stroke|from|to|via|outline|divide)-${palette}-\\d`), tsx)).toEqual([]);
});

// Syntax token colours are plugin-specific: defined in index.css's own :root and .dark, never in the copied host palette,
// and derived only from palette tokens (mixed toward --foreground), so they follow the host's theme. Their contrast on
// the diff tints is measured in harness/playwright/golden.mjs step 16.
test('syntax token colours are index.css properties derived from the palette, in both themes, and back every token class', () => {
  const css = readFileSync(path.join(src, 'index.css'), 'utf8');
  const block = (sel: string) => css.match(new RegExp(`^${sel.replace('.', '\\.')} \\{([^}]*)\\}`, 'm'))?.[1] ?? '';
  const props = (body: string) => Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2]]));
  const light = props(block(':root'));
  const dark = props(block('.dark'));
  const used = [...new Set(Object.values(TOKEN_CLASS).flatMap((c) => c.split(' ')).filter((c) => c.startsWith('text-')))].map((c) => c.slice('text-'.length));
  expect(used.every((u) => u.startsWith('token-'))).toBe(true);
  const names = used.map((u) => `--cr-${u}`).sort();
  // Exactly the token properties, in both themes: index.css's own blocks add no palette token.
  expect(Object.keys(light).sort()).toEqual(names);
  expect(Object.keys(dark).sort()).toEqual(names);
  const derived = /^color-mix\(in oklab, var\(--(plan|success|warning|info|primary|muted-foreground)\) \d{1,2}%, var\(--foreground\)\)$/;
  for (const v of [...Object.values(light), ...Object.values(dark)]) expect(v).toMatch(derived);
  for (const u of used) expect(css).toContain(`--color-${u}: var(--cr-${u});`);
  expect(readFileSync(path.join(src, 'cc-theme-fallback.css'), 'utf8')).not.toMatch(/--cr-|token-/);
});

test('the UI has no theme toggle of its own', () => {
  // public/theme-init.js is exempt: it is the standalone-only script that follows the OS scheme (no user control), and it must set the dark class.
  const files = all.filter((f) => path.relative(frontend, f) !== path.join('public', 'theme-init.js'));
  expect(offenders(/toggle[-_ ]?theme|theme[-_ ]?toggle|setTheme|classList\.(?:toggle|add)\(\s*['"]dark/i, files)).toEqual([]);
});

test('the Toaster follows the page theme', () => {
  expect(readFileSync(path.join(src, 'main.tsx'), 'utf8')).toMatch(/<Toaster theme=\{useTheme\(\)\}/);
});
