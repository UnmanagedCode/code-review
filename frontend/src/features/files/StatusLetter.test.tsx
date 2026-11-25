import { render } from '@testing-library/react';
import { expect, test } from 'vitest';
import type { FileState } from '@/lib/types';
import { StatusLetter } from './StatusLetter';

// Invariant: every status shows its one letter to sight and its full word to assistive tech.
test.each([['added', 'A'], ['deleted', 'D'], ['modified', 'M'], ['renamed', 'R']] as [FileState['status'], string][])('%s is the letter %s, read as the word', (status, letter) => {
  const { container } = render(<StatusLetter status={status} />);
  const [shown, word] = container.querySelectorAll('span > span');
  expect(shown.textContent).toBe(letter);
  expect(shown.getAttribute('aria-hidden')).toBe('true');
  expect(word.textContent).toBe(`${status} `); // the trailing space keeps the word apart from the name that follows it
});
