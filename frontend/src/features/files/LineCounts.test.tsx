import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { LineCounts } from './LineCounts';

// Invariant: counts of 10,000 or more are compacted (k, M) so a row stays bounded, below that they read exact, and the accessible name always carries the exact numbers.
test.each([
  [9999, 9999, '+9999−9999'],
  [10000, 12345, '+10k−12k'],
  [999999, 1000000, '+999k−1M'],
  [123456, 1234567, '+123k−1.2M'],
])('counts %i/%i show as %s with the exact numbers in the accessible name', (a, d, shown) => {
  render(<LineCounts additions={a} deletions={d} />);
  const img = screen.getByRole('img', { name: `${a} lines added, ${d} removed` });
  expect(img.textContent).toBe(shown);
});
