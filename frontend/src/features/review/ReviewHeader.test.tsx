import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { review } from '@/test/fixtures';
import { renderInReview } from '@/test/renderCtx';
import { stubFetch } from '@/test/stubFetch';
import { ReviewHeader } from './ReviewHeader';

test('"Mark all read" posts read with an empty body (the whole review)', async () => {
  const net = stubFetch({ 'POST api/reviews/r-1/read': { review: review() } });
  const user = userEvent.setup();
  renderInReview(<ReviewHeader />);
  await user.click(screen.getByRole('button', { name: 'Review actions' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Mark all read' }));
  await waitFor(() => expect(net.calls.map((c) => c.body)).toEqual([{}]));
});
