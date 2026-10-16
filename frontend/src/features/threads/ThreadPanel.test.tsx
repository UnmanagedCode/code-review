import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { diffFile, fileState, review, thread } from '@/test/fixtures';
import { ctxValue } from '@/test/renderCtx';
import { stubFetch } from '@/test/stubFetch';
import { ReviewProvider } from '@/state/reviewContext';
import { ThreadPanel } from './ThreadPanel';

test('the All list refreshes when the review reloads, even with no file open', async () => {
  let threads = [thread({ id: 't-1' })];
  const net = stubFetch({ 'GET api/reviews/r-1/diff': () => ({ review: review(), files: [diffFile({ threads })] }) });
  const files = [fileState({ threads: { open: 1, resolved: 0, outdated: 0 } })];
  const base = ctxValue({ files, fileDiff: { file: undefined, version: 0 } as never });
  const ui = (version: number) => <ReviewProvider value={{ ...base, version }}><ThreadPanel /></ReviewProvider>;
  const { rerender } = render(ui(1));
  await userEvent.setup().click(screen.getByRole('tab', { name: /^All/ }));
  expect(await screen.findAllByRole('article')).toHaveLength(1);
  threads = [thread({ id: 't-1' }), thread({ id: 't-2' })];
  rerender(ui(2));
  await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(2));
  expect(net.count('GET api/reviews/r-1/diff')).toBe(2);
});

test('"Next unread" focuses the first unread thread, which posts read {threadId}', async () => {
  const unread = thread({ id: 't-7', unread: 1 });
  const net = stubFetch({
    'GET api/reviews/r-1/diff': { review: review(), files: [diffFile({ threads: [thread({ id: 't-1' }), unread] })] },
    'POST api/reviews/r-1/read': { review: review() },
  });
  const files = [fileState({ threads: { open: 2, resolved: 0, outdated: 0 } })];
  const value = ctxValue({ files, fileDiff: { file: undefined } as never });
  const user = userEvent.setup();
  render(<ReviewProvider value={value}><ThreadPanel /></ReviewProvider>);
  await user.click(screen.getByRole('tab', { name: /^All/ }));
  await waitFor(() => expect((screen.getByRole('button', { name: 'Next unread' }) as HTMLButtonElement).disabled).toBe(false));
  await user.click(screen.getByRole('button', { name: 'Next unread' }));
  expect(location.search).toContain('thread=t-7');
  await waitFor(() => expect(net.calls.filter((c) => c.method === 'POST').map((c) => c.body)).toEqual([{ threadId: 't-7' }]));
});
