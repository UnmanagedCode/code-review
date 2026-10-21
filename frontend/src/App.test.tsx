import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { App } from './App';
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
    'src/lib/splitRows.ts', 'src/features/diff/SplitRow.tsx', 'src/features/diff/SettledThread.tsx', 'src/features/diff/HunkHeader.tsx', 'src/features/layout/ResizeHandle.tsx']) expect(seen).toContain(must);
  expect(seen.some((f) => f.startsWith('dist') || f.includes('node_modules'))).toBe(false);
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

test('the UI has no theme toggle of its own', () => {
  // public/theme-init.js is exempt: it is the standalone-only script that follows the OS scheme (no user control), and it must set the dark class.
  const files = all.filter((f) => path.relative(frontend, f) !== path.join('public', 'theme-init.js'));
  expect(offenders(/toggle[-_ ]?theme|theme[-_ ]?toggle|setTheme|classList\.(?:toggle|add)\(\s*['"]dark/i, files)).toEqual([]);
});

test('the Toaster follows the page theme', () => {
  expect(readFileSync(path.join(src, 'main.tsx'), 'utf8')).toMatch(/<Toaster theme=\{useTheme\(\)\}/);
});
