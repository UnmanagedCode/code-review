import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import { installFakeEventSource } from '@/test/fakeEventSource';
import { diffFile, fileState, review, thread } from '@/test/fixtures';
import { stubFetch } from '@/test/stubFetch';
import { ReviewView } from './ReviewView';

beforeEach(() => installFakeEventSource());

function world(status: 'open' | 'closed') {
  const file = diffFile({ threads: [thread()] });
  stubFetch({
    'GET api/reviews/r-1': { review: review({ status }), files: [fileState()], rounds: [], submissions: [], outdatedThreads: [] },
    'GET api/reviews/r-1/diff': (u: URL) => (u.searchParams.has('commit')
      ? { readOnly: true, commit: { sha: 'abc1234', subject: 's' }, files: [{ ...file, threads: [] }] }
      : { review: review({ status }), files: [file] }),
    'GET api/reviews/r-1/commits': { commits: [{ sha: 'abc1234', short: 'abc1234', author: 'a', date: 'd', subject: 's', merge: false }] },
    'GET api/reviews/r-1/file': { path: 'src/a.ts', side: 'new', total: 4, lines: [] },
    'GET api/sessions': { sessions: [] },
  });
}

test('an open review offers gutter selection and a reply box', async () => {
  world('open');
  history.replaceState(null, '', '?review=r-1&file=src%2Fa.ts');
  render(<ReviewView id="r-1" />);
  expect(await screen.findByRole('grid')).toBeTruthy();
  expect(document.querySelector('[data-cell]')).not.toBeNull();
  expect(screen.getAllByLabelText('Reply').length).toBeGreaterThan(0);
});

test('a closed review is read-only: no gutter selection and no reply box', async () => {
  world('closed');
  history.replaceState(null, '', '?review=r-1&file=src%2Fa.ts');
  render(<ReviewView id="r-1" />);
  await screen.findByRole('article', { name: 'comment thread' });
  expect(document.querySelector('[data-cell]')).toBeNull();
  expect(screen.queryByLabelText('Reply')).toBeNull();
});

test('the commit-filter view is read-only even on an open review', async () => {
  world('open');
  history.replaceState(null, '', '?review=r-1&file=src%2Fa.ts&commit=abc1234');
  render(<ReviewView id="r-1" />);
  await screen.findByRole('grid');
  await waitFor(() => expect(screen.queryByRole('group', { name: 'Hunk verdict' })).toBeNull());
  expect(document.querySelector('[data-cell]')).toBeNull();
  expect(screen.queryByLabelText('Reply')).toBeNull();
});
