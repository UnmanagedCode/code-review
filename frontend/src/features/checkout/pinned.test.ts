import { expect, test } from 'vitest';
import { pinFirst } from './pinned';

const items = ['a', 'b', 'c', 'd'].map((v) => ({ value: v, label: v.toUpperCase() }));
const values = (os: { value: string }[]) => os.map((o) => o.value);

test('pinned items lead in pinned order and the rest keep their original order', () => {
  const { top, rest } = pinFirst(items, ['c', 'a']);
  expect(values(top)).toEqual(['c', 'a']);
  expect(values(rest)).toEqual(['b', 'd']);
});

test('pinned values that are not items are dropped, and duplicates collapse', () => {
  const { top, rest } = pinFirst(items, ['zzz', 'b', 'b']);
  expect(values(top)).toEqual(['b']);
  expect(values(rest)).toEqual(['a', 'c', 'd']);
});

test('nothing pinned leaves everything in rest', () => {
  const { top, rest } = pinFirst(items, []);
  expect(top).toEqual([]);
  expect(rest).toEqual(items);
});
