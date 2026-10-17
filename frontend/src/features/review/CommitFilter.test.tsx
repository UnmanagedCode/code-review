import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { parseRoute } from '@/lib/route';
import { renderInReview } from '@/test/renderCtx';
import { stubFetch } from '@/test/stubFetch';
import { CommitFilter } from './CommitFilter';

test('picking a commit drops a round and the file position, mirroring the round picker dropping the commit', async () => {
  stubFetch({ 'GET api/reviews/r-1/commits': { commits: [{ sha: 'abc1234', short: 'abc1234', author: 'a', date: 'd', subject: 's', merge: false }] } });
  history.replaceState(null, '', '?review=r-1&round=1&file=a.js&lines=3&thread=t-1');
  renderInReview(<CommitFilter />);
  await userEvent.setup().selectOptions(await screen.findByRole('combobox', { name: 'Commit filter' }), 'abc1234');
  expect(parseRoute(location.search)).toEqual({ review: 'r-1', commit: 'abc1234' });
});
