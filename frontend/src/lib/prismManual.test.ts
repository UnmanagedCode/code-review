import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

test('loading Prism never rewrites a language-* element: Prism.manual is set before Prism evaluates', async () => {
  // Invariant: Prism never rewrites page markup (manual mode is set before it evaluates).
  const code = document.createElement('code');
  code.className = 'language-javascript';
  code.textContent = '<b>x</b>';
  document.body.append(code);
  await import('./highlight/prism');
  document.dispatchEvent(new Event('DOMContentLoaded'));
  await frame();
  await frame();
  expect(code.children).toHaveLength(0);
  expect(code.textContent).toBe('<b>x</b>');
  expect((globalThis as { Prism?: { manual?: boolean } }).Prism?.manual).toBe(true);
  code.remove();
});

test("lib/highlight/prism.ts imports ./prismManual before anything else", () => {
  // Invariant: the manual-mode side effect is the first import, ahead of prismjs.
  const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'highlight', 'prism.ts'), 'utf8');
  const first = src.match(/^import\s[^;]*;/m)?.[0];
  expect(first).toBe("import './prismManual';");
});
