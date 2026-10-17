import { screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { refusal } from '@/test/fixtures';
import { renderInReview } from '@/test/renderCtx';
import { stubFetch } from '@/test/stubFetch';
import { CitedExcerpt } from './CitedExcerpt';

test('a cited file outside the diff shows the cited lines read-only', async () => {
  history.replaceState(null, '', '?file=docs%2Fx.md&lines=2-3');
  const net = stubFetch({ 'GET api/reviews/r-1/file': { path: 'docs/x.md', side: 'new', total: 9, lines: [{ n: 2, text: '<b>two</b>' }, { n: 3, text: 'three' }] } });
  renderInReview(<CitedExcerpt path="docs/x.md" />);
  expect(await screen.findByText('<b>two</b>')).toBeTruthy();
  expect(net.calls[0].url.search).toBe('?path=docs%2Fx.md&side=new&start=2&end=3');
});

test('FILE_NOT_IN_DIFF reads as "not present at this round"', async () => {
  history.replaceState(null, '', '?file=gone.md&lines=1');
  stubFetch({ 'GET api/reviews/r-1/file': refusal('FILE_NOT_IN_DIFF', 404) });
  renderInReview(<CitedExcerpt path="gone.md" />);
  expect(await screen.findByText('Cited file isn’t present at this round')).toBeTruthy();
});

test('in a past-round view the excerpt is read from that round', async () => {
  history.replaceState(null, '', '?file=docs%2Fx.md&lines=2&round=1');
  const net = stubFetch({ 'GET api/reviews/r-1/file': { path: 'docs/x.md', side: 'new', total: 9, lines: [{ n: 2, text: 'then' }] } });
  renderInReview(<CitedExcerpt path="docs/x.md" />, { round: 1, readOnly: true });
  expect(await screen.findByText('then')).toBeTruthy();
  expect(net.calls[0].url.searchParams.get('round')).toBe('1');
});
