import { expect, test } from 'vitest';
import { ApiError } from './api';
import { menuFailure, menuLanding } from './menuTarget';
import { readMenuTarget } from './route';
import type { InboxItem } from './types';

const item = (id: string, project: string, worktree: string | null) => ({ id, project, worktree }) as InboxItem;

// Invariant: only cc's two params make a menu target; code-review's own route is not one, and an empty value counts as absent.
test('readMenuTarget reads ccProject/ccWorktree only', () => {
  expect(readMenuTarget('?ccProject=a')).toEqual({ project: 'a', worktree: null });
  expect(readMenuTarget('?ccProject=a&ccWorktree=w')).toEqual({ project: 'a', worktree: 'w' });
  expect(readMenuTarget('?ccWorktree=w')).toEqual({ project: null, worktree: 'w' });
  expect(readMenuTarget('?ccProject=')).toEqual({ project: null, worktree: null });
  expect(readMenuTarget('?project=a&worktree=w')).toBeNull();
  expect(readMenuTarget('')).toBeNull();
  expect(readMenuTarget('?ccProject=a%20b&ccWorktree=w%2Fx')).toEqual({ project: 'a b', worktree: 'w/x' });
});

// Invariant: exactly one open review of the very checkout opens it; anything else lands on that checkout's list. Names come from the lookup.
test('menuLanding opens the one open review of the checkout, else its list', () => {
  const main = { project: 'app', worktree: null };
  const feat = { project: 'app', worktree: 'feature' };
  expect(menuLanding(main, [])).toEqual({ project: 'app', worktree: undefined });
  expect(menuLanding(main, [item('r-1', 'app', null)])).toEqual({ project: 'app', worktree: undefined, review: 'r-1' });
  expect(menuLanding(main, [item('r-1', 'app', 'feature')])).toEqual({ project: 'app', worktree: undefined });
  expect(menuLanding(main, [item('r-1', 'other', null)])).toEqual({ project: 'app', worktree: undefined });
  expect(menuLanding(feat, [item('r-1', 'app', 'feature'), item('r-2', 'app', null)])).toEqual({ project: 'app', worktree: 'feature', review: 'r-1' });
  expect(menuLanding(feat, [item('r-1', 'app', 'feature'), item('r-2', 'app', 'feature')])).toEqual({ project: 'app', worktree: 'feature' });
});

// Invariant: every failure names what was wrong, quoting the names cc sent.
test('menuFailure names the missing project, the unknown project or worktree, else the error', () => {
  const t = { project: 'app', worktree: 'wt' };
  expect(menuFailure({ project: null, worktree: 'wt' })).toBe("Can't show reviews: code-conductor named no project.");
  expect(menuFailure(t, new ApiError(404, 'PROJECT_UNKNOWN', 'x'))).toBe("Can't show reviews: code-conductor lists no project “app”.");
  expect(menuFailure(t, new ApiError(404, 'CHECKOUT_UNKNOWN', 'x'))).toBe("Can't show reviews: project “app” has no worktree “wt”.");
  expect(menuFailure(t, new ApiError(502, 'CONDUCTOR_UNAVAILABLE', 'x'))).toMatch(/^Can't show reviews: Can't reach code-conductor/);
  expect(menuFailure(t, new TypeError('boom'))).toBe("Can't show reviews: Can't reach the code-review backend");
});
