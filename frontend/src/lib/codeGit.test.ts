import { expect, test } from 'vitest';
import { installBridge } from '@/test/fakeBridge';
import { installTop } from '@/test/fakeTop';
import { codeGitHref, codeGitSubpath, shownHeadSha } from './codeGit';

const SHA = 'a'.repeat(40);

// Invariant: untrusted values (project, worktree, path) stay inside their own key; code-git reads back exactly what was given.
test('the subpath parses back to exactly its target, whatever the values hold', () => {
  const target = { project: 'my app&x=1', worktree: 'wt/#2', commit: SHA, path: 'src/a b&c#d.ts' };
  const sub = codeGitSubpath(target);
  expect(sub.startsWith('?')).toBe(true);
  expect(Object.fromEntries(new URLSearchParams(sub))).toEqual(target);
  expect([...new URLSearchParams(sub).keys()]).toEqual(['project', 'worktree', 'commit', 'path']);
});

// Invariant: the contract's optional keys: no worktree for the main checkout, and `path` only with `commit`.
test('the main checkout has no worktree key, and a path without a commit is dropped', () => {
  expect(codeGitSubpath({ project: 'p', worktree: null })).toBe('?project=p');
  expect(codeGitSubpath({ project: 'p', worktree: null, path: 'a.ts' })).toBe('?project=p');
  expect(codeGitSubpath({ project: 'p', worktree: 'w', commit: SHA })).toBe(`?project=p&worktree=w&commit=${SHA}`);
});

// Invariant: following the link changes only cc's hash (a fragment navigation, no reload) to code-git's deep link.
test('the href keeps the top frame\'s path and query and only sets the hash', () => {
  installBridge();
  installTop({ pathname: '/cc/', search: '?x=1' });
  expect(codeGitHref('code-git', { project: 'p', worktree: 'w', commit: SHA })).toBe(`/cc/?x=1#plugin/code-git/?project=p&worktree=w&commit=${SHA}`);
  expect(codeGitHref('a b', { project: 'p', worktree: null })).toBe('/cc/?x=1#plugin/a%20b/?project=p');
});

// Invariant: no link where it could not work: standalone, outside a frame, or with an unreadable top frame.
test('the href is null without a bridge, unframed, or when the top frame cannot be read', () => {
  installTop();
  expect(codeGitHref('code-git', { project: 'p', worktree: null })).toBeNull();
  installBridge();
  installTop('unreadable');
  expect(codeGitHref('code-git', { project: 'p', worktree: null })).toBeNull();
});

test('unframed (top is this window) even with a bridge gives no href', () => {
  installBridge();
  expect(window.top).toBe(window);
  expect(codeGitHref('code-git', { project: 'p', worktree: null })).toBeNull();
});

const rounds = [1, 2, 3].map((n) => ({ n, headSha: String(n).repeat(40), baseSha: 'b'.repeat(40), createdAt: '', submittedAt: null }));
const ctx = (over: Partial<Parameters<typeof shownHeadSha>[0]> = {}) => ({ review: { headSha: 'f'.repeat(40) }, rounds, commit: undefined, round: undefined, compare: undefined, ...over });

// Invariant: the file-history link opens the commit whose content the diff's new side shows.
test('shownHeadSha picks the sha of the new side for each view', () => {
  expect(shownHeadSha(ctx())).toBe('f'.repeat(40));
  expect(shownHeadSha(ctx({ round: 2 }))).toBe('2'.repeat(40));
  expect(shownHeadSha(ctx({ compare: { to: 3 } }))).toBe('3'.repeat(40));
  expect(shownHeadSha(ctx({ commit: SHA, round: 2 }))).toBe(SHA);
});

// Invariant: code-git gets a full sha only; an abbreviated commit filter is looked up, and an unknown one gives no link.
test('an abbreviated commit filter resolves through the commits list, else null', () => {
  const commits = [{ sha: `abc1234${'0'.repeat(33)}`, short: 'abc1234', author: '', date: '', subject: '', merge: false }];
  expect(shownHeadSha(ctx({ commit: 'abc1234' }), commits)).toBe(commits[0].sha);
  expect(shownHeadSha(ctx({ commit: 'abc1234' }))).toBeNull();
  expect(shownHeadSha(ctx({ commit: 'fff0000' }), commits)).toBeNull();
  expect(shownHeadSha(ctx({ round: 9 }))).toBeNull();
});
