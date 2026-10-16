import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { App } from './App';
import { stubFetch } from './test/stubFetch';

const src = path.dirname(fileURLToPath(import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(tsx?|jsx?)$/.test(name) && !/\.test\./.test(name) && !p.includes(`${path.sep}test${path.sep}`) ? [p] : [];
  });
}
const offenders = (re: RegExp, files = sources(src)) => files.filter((f) => re.test(readFileSync(f, 'utf8'))).map((f) => path.relative(src, f));

test('with no checkout chosen, App offers the project picker', async () => {
  stubFetch({ 'GET api/projects': { projects: [{ name: 'app' }] } });
  render(<App />);
  expect(await screen.findByText('Choose a project to review')).toBeTruthy();
  expect(await screen.findByRole('option', { name: 'app' })).toBeTruthy();
});

// Content must reach the DOM as text, never markup: a model reply rendered raw is script with cc's API.
test('UI source uses no raw-markup or dynamic-code escape hatch', () => {
  expect(offenders(/dangerouslySetInnerHTML|\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(/)).toEqual([]);
});

test('UI source never assigns location.hash', () => {
  expect(offenders(/location\.hash\s*=[^=]/)).toEqual([]);
});

test('localStorage is used only by lib/storage.ts', () => {
  expect(offenders(/localStorage/)).toEqual([path.join('lib', 'storage.ts')]);
});

test('no root-relative fetch or EventSource URL (it would reach cc, not this plugin)', () => {
  expect(offenders(/(?:fetch|EventSource)\(\s*['"`]\//)).toEqual([]);
});

test('colours come from tokens: no literal colours and no Tailwind palette colour classes', () => {
  const tsx = sources(src).filter((f) => f.endsWith('.tsx'));
  expect(offenders(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/, tsx)).toEqual([]);
  const palette = '(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)';
  expect(offenders(new RegExp(`\\b(?:bg|text|border|ring|fill|stroke|from|to|via|outline|divide)-${palette}-\\d`), tsx)).toEqual([]);
});

test('the UI has no theme toggle of its own', () => {
  expect(offenders(/toggle[-_ ]?theme|theme[-_ ]?toggle|setTheme|classList\.(?:toggle|add)\(\s*['"]dark/i)).toEqual([]);
});

test('the Toaster follows the page theme', () => {
  expect(readFileSync(path.join(src, 'main.tsx'), 'utf8')).toMatch(/<Toaster theme=\{useTheme\(\)\}/);
});
