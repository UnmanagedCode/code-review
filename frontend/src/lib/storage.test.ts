import { expect, test } from 'vitest';
import { getItem, setItem } from './storage';

test('every key written is code-review: prefixed', () => {
  setItem('lastCheckout', 'x');
  expect(Object.keys(localStorage)).toEqual(['code-review:lastCheckout']);
  expect(getItem('lastCheckout')).toBe('x');
});

test('cc’s code-conductor: keys are never read', () => {
  localStorage.setItem('code-conductor:lastCheckout', 'cc');
  expect(getItem('lastCheckout')).toBeNull();
});
