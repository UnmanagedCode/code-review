import { render, screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { fileState } from '@/test/fixtures';
import { FileTree } from './FileTree';

test('rows expose verdict tally, thread counts, hunk counts and unread as accessible text', () => {
  render(<FileTree selected="src/a.ts" files={[
    fileState({ path: 'src/a.ts', verdicts: { pending: 2, accepted: 1, rejected: 3 }, threads: { open: 4, resolved: 5, outdated: 6 }, unread: 2 }),
    fileState({ path: 'b.ts', verdicts: null, hunks: 3 }),
  ]} />);
  const a = screen.getByRole('link', { name: /a\.ts/ });
  const w = within(a);
  expect(w.getByText('1 accepted, 3 rejected, 2 pending')).toBeTruthy();
  expect(w.getByText('4 open, 5 resolved, 6 outdated')).toBeTruthy();
  expect(w.getByRole('img', { name: '2 unread' })).toBeTruthy();
  expect(a.getAttribute('aria-current')).toBe('true');
  expect(within(screen.getByRole('link', { name: /b\.ts/ })).getByText('3 hunks')).toBeTruthy();
});

test('a file link carries the file in its query and nests under its directory', () => {
  render(<FileTree selected={undefined} files={[fileState({ path: 'src/lib/c.ts' })]} />);
  expect(screen.getByText('src/')).toBeTruthy();
  expect(screen.getByRole('link', { name: /c\.ts/ }).getAttribute('href')).toBe('?file=src%2Flib%2Fc.ts');
});
