import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { App } from './App';

const src = path.dirname(fileURLToPath(import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(tsx?|jsx?)$/.test(name) && !/\.test\./.test(name) ? [p] : [];
  });
}

test('App renders its placeholder as text', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: 'Code Review' })).toBeTruthy();
});

// Content must reach the DOM as text, never markup: a model reply rendered raw is script with cc's API.
test('UI source uses no raw-markup or dynamic-code escape hatch', () => {
  const banned = /dangerouslySetInnerHTML|\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(/;
  const offenders = sources(src).filter((f) => banned.test(readFileSync(f, 'utf8')));
  expect(offenders).toEqual([]);
});
