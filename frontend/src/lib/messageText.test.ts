import { expect, test } from 'vitest';
import { segment } from './messageText';

const cite = (raw: string, path: string, startLine: number, endLine = startLine) => ({ raw, path, startLine, endLine });

test('text, citation and URL segments come out in body order', () => {
  const body = 'see src/a.ts#L1-L3 and https://example.com/x, thanks';
  expect(segment(body, [cite('src/a.ts#L1-L3', 'src/a.ts', 1, 3)])).toEqual([
    { t: 'text', text: 'see ' },
    { t: 'cite', text: 'src/a.ts#L1-L3', path: 'src/a.ts', start: 1, end: 3 },
    { t: 'text', text: ' and ' },
    { t: 'url', text: 'https://example.com/x', href: 'https://example.com/x' },
    { t: 'text', text: ', thanks' },
  ]);
});

test('a raw citation repeated in the body is linked each time it is listed', () => {
  const c = cite('a.ts#L2', 'a.ts', 2);
  const out = segment('a.ts#L2 then a.ts#L2', [c, c]);
  expect(out.filter((s) => s.t === 'cite')).toHaveLength(2);
});

test('absolute and parent-escaping citation paths stay text', () => {
  const body = '../x#L1 and /etc/x#L1';
  const out = segment(body, [cite('../x#L1', '../x', 1), cite('/etc/x#L1', '/etc/x', 1)]);
  expect(out).toEqual([{ t: 'text', text: body }]);
});

test('javascript: and data: URLs are never linked', () => {
  const body = 'javascript:alert(1) data:text/html,<b>x</b>';
  expect(segment(body, []).every((s) => s.t === 'text')).toBe(true);
});

test('a citation the body does not contain is skipped', () => {
  expect(segment('plain', [cite('nope#L1', 'nope', 1)])).toEqual([{ t: 'text', text: 'plain' }]);
});
