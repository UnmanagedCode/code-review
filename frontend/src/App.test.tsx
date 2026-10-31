import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from './App';
import { parseRoute } from './lib/route';
import { TOKEN_CLASS } from './lib/highlight';
import { installFakeEventSource } from './test/fakeEventSource';
import type { InboxItem } from './lib/types';
import { installBridge } from './test/fakeBridge';
import { diffFile, fileState, inboxItem, refusal, review } from './test/fixtures';
import { stubFetch, type Call } from './test/stubFetch';

// Counts App mounts: useMenuTarget is called by App alone, so its wrapper's mount effect runs once per App mount.
const appMounts = vi.hoisted(() => ({ n: 0 }));
vi.mock('@/features/layout/useMenuTarget', async (importOriginal) => {
  const { useEffect } = await import('react');
  const real = await importOriginal<typeof import('@/features/layout/useMenuTarget')>();
  return {
    useMenuTarget: () => {
      useEffect(() => { appMounts.n += 1; }, []);
      return real.useMenuTarget();
    },
  };
});

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
    'src/lib/highlight/prism.ts', 'src/features/diff/CodeLine.tsx', 'src/lib/sseWorker.ts']) expect(seen).toContain(must);
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

// Code-conductor's row menu: `?ccProject=&ccWorktree=` on load, or after cc's navigate + a popstate.
describe('menu', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  const WORKTREES: Record<string, (string | null)[]> = { app: [null, 'feature', 'other-wt'], other: [null] };
  const detail = (id: string, title: string) => ({
    review: review({ id, title }), files: [fileState({ path: 'a.js' })], rounds: [{ n: 1, headSha: 'a'.repeat(40), baseSha: 'b'.repeat(40), createdAt: '', submittedAt: null }],
    submissions: [], outdatedThreads: [], reviewThreads: [],
  });
  /** `app` (main, feature, other-wt) and `other`; `lookup`/`inbox` override those routes, `listed` is what `api/reviews` lists. */
  function menuWorld({ inbox = [] as InboxItem[], listed = [] as ReturnType<typeof review>[], lookup, inboxRoute, checkout }: {
    inbox?: InboxItem[]; listed?: ReturnType<typeof review>[]; lookup?: (u: URL) => unknown; inboxRoute?: () => unknown; checkout?: () => unknown;
  } = {}) {
    installFakeEventSource();
    const lookupRoute = (u: URL) => {
      const project = u.searchParams.get('project')!;
      const worktree = u.searchParams.get('worktree');
      if (!WORKTREES[project]) return refusal('PROJECT_UNKNOWN', 404);
      if (!WORKTREES[project].includes(worktree)) return refusal('CHECKOUT_UNKNOWN', 404);
      return { ok: true, checkout: { project, worktree } };
    };
    return stubFetch([
      [/^GET api\/projects$/, { projects: [{ name: 'app' }, { name: 'other' }] }],
      [/^GET api\/checkout\/lookup\?/, lookup ?? lookupRoute],
      [/^GET api\/checkout\?/, checkout ?? ((u: URL) => ({
        checkout: { project: u.searchParams.get('project'), worktree: u.searchParams.get('worktree'), path: '/x', branch: 'main', headSha: 'h', dirty: false, exists: true },
        forkPoints: [], worktrees: [{ worktreeName: 'feature', branch: 'feature' }, { worktreeName: 'other-wt', branch: 'other-wt' }],
      }))],
      [/^GET api\/sessions\/[^/?]+\/places$/, { places: [] }],
      [/^GET api\/sessions/, { sessions: [] }],
      [/^GET api\/inbox$/, inboxRoute ?? { reviews: inbox }],
      [/^GET api\/reviews\?/, { reviews: listed }],
      [/^GET api\/reviews\/r-1$/, detail('r-1', 'Review one')],
      [/^GET api\/reviews\/r-2$/, detail('r-2', 'Review two')],
      [/^GET api\/reviews\/r-\d\/diff/, (u: URL) => ({ review: review({ id: u.pathname.split('/')[3] }), files: [diffFile({ path: 'a.js' })] })],
      [/^GET api\/reviews\/r-\d\/commits/, { commits: [] }],
    ]);
  }
  const navigateCc = (search: string) => act(() => {
    history.replaceState(null, '', search);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  const gets = (calls: Call[], path: string) => calls.filter((c) => c.url.pathname === `/${path}`);
  const onlyGets = (calls: Call[]) => expect(calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.url.pathname}`)).toEqual([]);
  const menuError = () => vi.spyOn(toast, 'error').mockImplementation(() => '');

  // Invariant: a checkout with exactly one open review opens it, in place of the cc params, adding no history entry.
  test('menu: ?ccProject&ccWorktree with one open review of that worktree opens it', async () => {
    const { calls } = menuWorld({ inbox: [inboxItem({ id: 'r-1', worktree: 'feature' }), inboxItem({ id: 'r-2', worktree: 'other-wt' })] });
    history.replaceState(null, '', '?ccProject=app&ccWorktree=feature');
    const length = history.length;
    render(<App />);
    await screen.findByRole('heading', { name: 'Review one' });
    expect(location.search).toBe('?project=app&worktree=feature&review=r-1');
    expect(history.length).toBe(length);
    onlyGets(calls);
  });

  // Invariant: no open review of the checkout lands on its Checkout tab, main checkout for a project row, listing This checkout / Open.
  test('menu: ?ccProject alone with no open review lands on the main checkout\'s list, saying No open reviews', async () => {
    const { calls } = menuWorld();
    history.replaceState(null, '', '?ccProject=app');
    render(<App />);
    expect(await screen.findByText('No open reviews')).toBeTruthy();
    expect(location.search).toBe('?project=app');
    expect((screen.getByLabelText('Worktree') as HTMLSelectElement).value).toBe('');
    const listed = gets(calls, 'api/reviews').at(-1)!.url.searchParams;
    expect([listed.get('project'), listed.get('worktree'), listed.get('status')]).toEqual(['app', '', 'open']);
    onlyGets(calls);
  });

  // Invariant: two or more open reviews need a choice, so the list is shown and no review opens.
  test('menu: two open reviews of the checkout land on the list', async () => {
    const { calls } = menuWorld({
      inbox: [inboxItem({ id: 'r-1', worktree: 'feature' }), inboxItem({ id: 'r-2', worktree: 'feature' })],
      listed: [review({ id: 'r-1', title: 'Review one', worktree: 'feature' }), review({ id: 'r-2', title: 'Review two', worktree: 'feature' })],
    });
    history.replaceState(null, '', '?ccProject=app&ccWorktree=feature');
    render(<App />);
    expect(await screen.findByText('Review one')).toBeTruthy();
    expect(screen.getByText('Review two')).toBeTruthy();
    expect(location.search).toBe('?project=app&worktree=feature');
    onlyGets(calls);
  });

  // Invariant: only open reviews of the very checkout count; one on another worktree of the project does not open.
  test('menu: an open review of another worktree does not count for the main checkout', async () => {
    const { calls } = menuWorld({ inbox: [inboxItem({ id: 'r-1', worktree: 'feature' })] });
    history.replaceState(null, '', '?ccProject=app');
    render(<App />);
    expect(await screen.findByText('No open reviews')).toBeTruthy();
    expect(location.search).toBe('?project=app');
    onlyGets(calls);
  });

  /** Opens r-1 on `app`/`feature` through an ordinary route, the page cc's navigate then retargets. */
  async function openOnReview() {
    history.replaceState(null, '', '?project=app&worktree=feature&review=r-1');
    render(<App />);
    return screen.findByRole('heading', { name: 'Review one' });
  }

  // Invariant: an unusable target toasts a message naming it and changes nothing: the route, the mounted review, no cc params left; a missing project asks the backend nothing.
  test.each([
    ['an unknown project', '?ccProject=ghost&ccWorktree=feature', 'ghost', true],
    ['an unknown worktree', '?ccProject=app&ccWorktree=nope', 'nope', true],
    ['a worktree with no project', '?ccWorktree=feature', 'named no project', false],
    ['an empty project', '?ccProject=', 'named no project', false],
  ])('menu: %s toasts, keeps the open review and the route', async (_n, search, name, asks) => {
    const { calls } = menuWorld({ inbox: [inboxItem({ id: 'r-2', worktree: 'feature' })] });
    const error = menuError();
    const heading = await openOnReview();
    const before = calls.length;
    const length = history.length;
    navigateCc(search);
    await waitFor(() => expect(error).toHaveBeenCalledTimes(1));
    expect(error.mock.calls[0][0]).toContain(name);
    expect(location.search).toBe('?project=app&worktree=feature&review=r-1');
    expect(history.length).toBe(length);
    expect(screen.getByRole('heading', { name: 'Review one' })).toBe(heading);
    const asked = calls.slice(before).filter((c) => ['/api/checkout/lookup', '/api/inbox'].includes(c.url.pathname));
    expect(asked.length > 0).toBe(asks);
    onlyGets(calls);
  });

  // Invariant: a failing lookup or inbox request toasts and leaves the route as it was.
  test.each([
    ['the lookup fails (500)', { lookup: () => refusal('INTERNAL', 500) }],
    ['cc is unreachable (502)', { lookup: () => refusal('CONDUCTOR_UNAVAILABLE', 502) }],
    ['the inbox fails', { inboxRoute: () => refusal('INTERNAL', 500) }],
  ])('menu: when %s it toasts and keeps the route', async (_n, over) => {
    const { calls } = menuWorld(over);
    const error = menuError();
    await openOnReview();
    navigateCc('?ccProject=app');
    await waitFor(() => expect(error).toHaveBeenCalledTimes(1));
    expect(error.mock.calls[0][0]).toMatch(/^Can't show reviews: /);
    expect(location.search).toBe('?project=app&worktree=feature&review=r-1');
    expect(screen.getByRole('heading', { name: 'Review one' })).toBeTruthy();
    onlyGets(calls);
  });

  // Invariant: cc's navigate retargets the open page in place (App stays mounted), replacing the entry: from an open review to another checkout's landing.
  test('menu: a cc navigate while a review is open retargets to the other checkout in place, without a new history entry', async () => {
    const { calls } = menuWorld({ inbox: [inboxItem({ id: 'r-1', worktree: 'feature' }), inboxItem({ id: 'r-2', worktree: 'other-wt' })] });
    appMounts.n = 0;
    await openOnReview();
    const length = history.length;
    navigateCc('?ccProject=app&ccWorktree=other-wt');
    await screen.findByRole('heading', { name: 'Review two' });
    expect(location.search).toBe('?project=app&worktree=other-wt&review=r-2');
    navigateCc('?ccProject=app');
    expect(await screen.findByText('No open reviews')).toBeTruthy();
    expect(location.search).toBe('?project=app');
    expect(history.length).toBe(length);
    expect(appMounts.n).toBe(1);
    onlyGets(calls);
  });

  // Invariant: when an older target's requests resolve last, only the newer target lands.
  test('menu: latest wins when an older lookup resolves last', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    const { calls } = menuWorld({
      inbox: [inboxItem({ id: 'r-1', worktree: 'feature' })],
      lookup: async (u) => {
        const worktree = u.searchParams.get('worktree');
        if (worktree === 'feature') await held;
        return { ok: true, checkout: { project: 'app', worktree } };
      },
    });
    history.replaceState(null, '', '?ccProject=app&ccWorktree=feature');
    render(<App />);
    await waitFor(() => expect(gets(calls, 'api/checkout/lookup')).toHaveLength(1));
    navigateCc('?ccProject=app');
    expect(await screen.findByText('No open reviews')).toBeTruthy();
    await act(async () => { release(); await held; });
    await act(async () => {});
    expect(location.search).toBe('?project=app');
    expect(screen.queryByRole('heading', { name: 'Review one' })).toBeNull();
    onlyGets(calls);
  });

  // Invariant: a navigation the user makes while the lookup is in flight wins: the landing is dropped, with no toast.
  test('menu: picking another checkout while the lookup is pending keeps the user\'s choice', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    const { calls, count } = menuWorld({
      inbox: [inboxItem({ id: 'r-1', worktree: 'feature' })],
      lookup: async (u) => { await held; return { ok: true, checkout: { project: 'app', worktree: u.searchParams.get('worktree') } }; },
    });
    const error = menuError();
    history.replaceState(null, '', '?ccProject=app&ccWorktree=feature');
    render(<App />);
    await screen.findByRole('option', { name: 'other' });
    await waitFor(() => expect(count('GET api/checkout/lookup')).toBe(1));
    await userEvent.setup().selectOptions(screen.getByLabelText('Project'), 'other');
    expect(location.search).toBe('?project=other');
    await act(async () => { release(); await held; });
    await act(async () => {});
    expect(location.search).toBe('?project=other');
    expect(screen.queryByRole('heading', { name: 'Review one' })).toBeNull();
    expect(error).not.toHaveBeenCalled();
    onlyGets(calls);
  });

  // Invariant: the landing replaced the cc params, so a reload shows the landed route and never repeats the lookup.
  test('menu: a reload after the landing shows the landed route and asks nothing again', async () => {
    const { calls } = menuWorld({ inbox: [inboxItem({ id: 'r-1', worktree: 'feature' })] });
    history.replaceState(null, '', '?ccProject=app&ccWorktree=feature');
    const { unmount } = render(<App />);
    await screen.findByRole('heading', { name: 'Review one' });
    unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Review one' });
    await act(async () => {});
    expect(location.search).toBe('?project=app&worktree=feature&review=r-1');
    expect(gets(calls, 'api/checkout/lookup')).toHaveLength(1);
  });

  // Invariant: a load from the row menu is not raced by session following: the session's checkout is never visited; later session changes still follow.
  // The lookup is held until the project list has loaded and session following has had its first run, so that run sees no
  // route project: only the menu-load skip keeps it from writing the session's checkout (`?project=other`).
  test('menu: a load from the menu never navigates to the active session\'s checkout first; later session changes follow', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    const { calls, count } = menuWorld({
      lookup: async (u) => { await held; return { ok: true, checkout: { project: 'app', worktree: u.searchParams.get('worktree') } }; },
    });
    const bridge = installBridge({ sessionId: 's-1', project: 'other', worktree: null });
    const replace = vi.spyOn(history, 'replaceState');
    history.replaceState(null, '', '?ccProject=app&ccWorktree=feature');
    render(<App />);
    await screen.findByRole('option', { name: 'other' });
    await act(async () => {});
    expect(count('GET api/projects')).toBe(1);
    expect(location.search).toBe('');
    await act(async () => { release(); await held; });
    expect(await screen.findByText('No open reviews')).toBeTruthy();
    await act(async () => {});
    expect(location.search).toBe('?project=app&worktree=feature');
    expect(replace.mock.calls.map((c) => c[2]).filter((u) => String(u).includes('other'))).toEqual([]);
    act(() => bridge.emit({ sessionId: 's-2', project: 'other', worktree: null }));
    await waitFor(() => expect(location.search).toBe('?project=other'));
    onlyGets(calls);
  });

  // Invariant: each list landing resets the list's selects to This checkout / Open.
  test('menu: a list landing resets the selects to This checkout / Open', async () => {
    menuWorld();
    history.replaceState(null, '', '?ccProject=app');
    render(<App />);
    await screen.findByText('No open reviews');
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Scope'), 'project');
    await user.selectOptions(screen.getByLabelText('Status'), 'closed');
    navigateCc('?ccProject=app');
    await waitFor(() => expect((screen.getByLabelText('Scope') as HTMLSelectElement).value).toBe('checkout'));
    expect((screen.getByLabelText('Status') as HTMLSelectElement).value).toBe('open');
  });

  // Invariant: the arrival needs no git on the checkout's System, so a down System still lands and lists the store's reviews.
  test('menu: a project whose System is down still lands on its list', async () => {
    const { calls } = menuWorld({
      checkout: () => refusal('SYSTEM_UNREACHABLE', 502),
      listed: [review({ id: 'r-1', title: 'Review one', worktree: 'feature' }), review({ id: 'r-2', title: 'Review two', worktree: 'feature' })],
      inbox: [inboxItem({ id: 'r-1', worktree: 'feature' }), inboxItem({ id: 'r-2', worktree: 'feature' })],
    });
    history.replaceState(null, '', '?ccProject=app&ccWorktree=feature');
    render(<App />);
    expect(await screen.findByText('Review one')).toBeTruthy();
    expect(location.search).toBe('?project=app&worktree=feature');
    onlyGets(calls);
  });

  // Invariant: a landing persists nothing: the remembered checkout is untouched (and not restored over the target).
  test('menu: a landing leaves the remembered checkout alone', async () => {
    menuWorld();
    const remembered = JSON.stringify({ project: 'other', worktree: null });
    localStorage.setItem('code-review:lastCheckout', remembered);
    history.replaceState(null, '', '?ccProject=app&ccWorktree=feature');
    render(<App />);
    await screen.findByText('No open reviews');
    await act(async () => {});
    expect(location.search).toBe('?project=app&worktree=feature');
    expect(localStorage.getItem('code-review:lastCheckout')).toBe(remembered);
  });
});
