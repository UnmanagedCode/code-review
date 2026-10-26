import { screen, waitFor } from '@testing-library/react';
import { expect, test } from 'vitest';
import { resetCodeGit } from '@/lib/codeGit';
import type { DiffFile } from '@/lib/types';
import { installBridge } from '@/test/fakeBridge';
import { installTop, resetTop } from '@/test/fakeTop';
import { diffFile, refusal, review } from '@/test/fixtures';
import { renderDiff } from '@/test/renderCtx';
import { stubFetch } from '@/test/stubFetch';
import type { ReviewCtx } from '@/state/reviewContext';
import { FileDiff } from './FileDiff';

const HEAD = 'a'.repeat(40);
const LABEL = /Open the history of .* in code-git/;
const embed = (codeGit: unknown = { codeGit: { id: 'code-git' } }, extra: Record<string, unknown> = {}) => {
  installBridge();
  installTop({ pathname: '/', search: '' });
  return stubFetch({ 'GET api/integrations': codeGit, ...extra });
};
const show = (file: Partial<DiffFile> = {}, over: Partial<ReviewCtx> = {}) => {
  history.replaceState(null, '', '?file=src%2Fa.ts');
  return renderDiff(<FileDiff />, diffFile({ path: 'src/a.ts', ...file }), over);
};
const subpath = (a: HTMLElement) => new URLSearchParams(a.getAttribute('href')!.split('#plugin/code-git/')[1]);

// Invariant: the file header opens that file's history in code-git at the commit the diff shows, in cc's top frame.
test('the file header links to the file\'s history at the shown commit', async () => {
  embed();
  show({}, { review: review({ headSha: HEAD }) });
  const a = await screen.findByRole('link', { name: LABEL });
  expect(a.getAttribute('target')).toBe('_top');
  expect(Object.fromEntries(subpath(a))).toEqual({ project: 'app', worktree: 'feature', commit: HEAD, path: 'src/a.ts' });
});

// Invariant: an abbreviated commit filter (e.g. from an MCP link) is turned into the full sha before it is linked.
test('an abbreviated commit filter links to its full sha from the review\'s commits', async () => {
  const full = `abc1234${'0'.repeat(33)}`;
  embed(undefined, { 'GET api/reviews/r-1/commits': { commits: [{ sha: full, short: 'abc1234', author: '', date: '', subject: '', merge: false }] } });
  show({}, { commit: 'abc1234', readOnly: true });
  expect(subpath(await screen.findByRole('link', { name: LABEL })).get('commit')).toBe(full);
});

// Invariant: no link to a history the shown commit does not have.
test('a deleted file, and an uncommitted review\'s added or renamed file, get no link', async () => {
  const net = embed();
  for (const [file, kind] of [[{ status: 'deleted' }, 'range'], [{ status: 'added' }, 'uncommitted'], [{ status: 'renamed', oldPath: 'b.ts' }, 'uncommitted']] as const) {
    const { unmount } = show(file, { review: review({ kind }) });
    await waitFor(() => expect(net.count('GET api/integrations')).toBe(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole('link', { name: LABEL }), JSON.stringify(file)).toBeNull();
    unmount();
  }
  show({ status: 'added' }, { review: review({ kind: 'range' }) });
  expect(await screen.findByRole('link', { name: LABEL })).toBeTruthy();
});

// Invariant: the link is hidden whenever it could not open code-git.
test('no link without code-git, when integrations fail, or standalone', async () => {
  for (const answer of [{ codeGit: null }, refusal('CONDUCTOR_UNAVAILABLE', 502)]) {
    resetCodeGit();
    const net = embed(answer);
    const { unmount } = show();
    await waitFor(() => expect(net.count('GET api/integrations')).toBe(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole('link', { name: LABEL })).toBeNull();
    unmount();
  }
  resetCodeGit();
  resetTop();
  delete window.ccBridge;
  const net = stubFetch({ 'GET api/integrations': { codeGit: { id: 'code-git' } } });
  show();
  await new Promise((r) => setTimeout(r, 0));
  expect(screen.queryByRole('link', { name: LABEL })).toBeNull();
  expect(net.count('GET api/integrations')).toBe(0);
});
