import { expect, test } from 'vitest';
import { ageLabel } from './age';

const NOW = Date.parse('2026-01-10T12:00:00Z');
const before = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;

// Invariant: the label steps at the minute, hour and day boundaries and rounds down, against the injected clock.
test('minute, hour and day boundaries', () => {
  expect(ageLabel(before(59_999), NOW)).toBe('just now');
  expect(ageLabel(before(MIN), NOW)).toBe('1 min');
  expect(ageLabel(before(59 * MIN + 59_999), NOW)).toBe('59 min');
  expect(ageLabel(before(60 * MIN), NOW)).toBe('1 h');
  expect(ageLabel(before(24 * 60 * MIN - 1), NOW)).toBe('23 h');
  expect(ageLabel(before(24 * 60 * MIN), NOW)).toBe('1 d');
  expect(ageLabel(before(3.5 * 24 * 60 * MIN), NOW)).toBe('3 d');
});

// Invariant: a time slightly in the future (clock skew) reads as just now, never negative.
test('a future time is just now', () => {
  expect(ageLabel(before(-5000), NOW)).toBe('just now');
});
