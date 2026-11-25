import { expect, test } from 'vitest';
import type { Route } from '@/lib/route';
import { guideView, review } from '@/test/fixtures';
import { paneTab } from './paneTab';

const ctx = { review: review({ kind: 'range' }), guide: guideView(), pastView: false, commit: undefined };
const tab = (route: Route, over: Partial<Parameters<typeof paneTab>[1]> = {}) => paneTab(route, { ...ctx, ...over });

// Invariant: an absent view is the review's default tab, and an explicit view always beats the default.
test('absent view follows guidedDefault', () => {
  expect(tab({}, { guidedDefault: true })).toBe('guided');
  expect(tab({})).toBe('files');
});
test('view=files wins over guidedDefault', () => {
  expect(tab({ view: 'files' }, { guidedDefault: true })).toBe('files');
});
test('explicit threads, history and guided win over the default', () => {
  expect(tab({ view: 'threads' }, { guidedDefault: true })).toBe('threads');
  expect(tab({ view: 'history' }, { guidedDefault: true })).toBe('history');
  expect(tab({ view: 'guided' })).toBe('guided');
});
test('guidedDefault where Guided is unavailable falls to Files', () => {
  expect(tab({}, { guidedDefault: true, pastView: true })).toBe('files');
});
test('view=overview shows Files in the pane', () => {
  expect(tab({ view: 'overview' }, { guidedDefault: true })).toBe('files');
});
