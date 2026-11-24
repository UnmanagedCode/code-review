import { expect, test } from 'vitest';
import { ago } from './relativeTime';

// Invariant: the clock is injected, so the same instants always read the same.
test('ago reads an instant relative to the given now', () => {
  const now = Date.parse('2026-01-10T12:00:00Z');
  expect(ago('2026-01-10T09:00:00Z', now)).toBe('3 hours ago');
  expect(ago('2026-01-08T12:00:00Z', now)).toBe('2 days ago');
  expect(ago('2026-01-10T11:59:50Z', now)).toBe('now');
});
