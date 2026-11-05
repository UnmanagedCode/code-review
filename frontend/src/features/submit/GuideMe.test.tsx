import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { installBridge } from '@/test/fakeBridge';
import { review } from '@/test/fixtures';
import { sampleGuide } from '@/test/guideWorld';
import { renderInReview } from '@/test/renderCtx';
import { stubFetch } from '@/test/stubFetch';
import { GuideMeButton } from '@/features/guide/GuideMeButton';
import { SubmitControls } from './SubmitControls';

const OFFER = { offered: true, noGroups: true, droppedGroups: 0, newUngrouped: 0 };
const sub = { id: 7, kind: 'guide', round: 1, recipient: 's-author', text: 'please group the round', status: 'pending' };
const net = () => stubFetch({
  'POST api/reviews/r-1/guide': { submission: sub },
  'POST api/reviews/r-1/submissions/7/result': { submission: { ...sub, status: 'delivered' } },
});
const results = (n: ReturnType<typeof stubFetch>) => n.calls.filter((c) => c.url.pathname.endsWith('/result')).map((c) => c.body);
const press = (name: string) => userEvent.setup().click(screen.getByRole('button', { name }));
const show = (over = {}) => renderInReview(<GuideMeButton />, { guide: sampleGuide({ guideMe: OFFER }), ...over });

test('with a bridge: composes the guide prompt, sends it to the recipient and records the delivery', async () => {
  // Invariant: Guide me is delivered like a round: compose, bridge send, record ok.
  const bridge = installBridge();
  const n = net();
  const { value } = show();
  await press('Guide me');
  await waitFor(() => expect(results(n)).toEqual([{ ok: true }]));
  expect(n.calls[0].url.pathname).toBe('/api/reviews/r-1/guide');
  expect(bridge.sendPrompt).toHaveBeenCalledWith('s-author', 'please group the round');
  expect(value.reload).toHaveBeenCalled();
});

test('a bridge failure shows the dialog titled Guide me, records the code, and Retry sends the same submission', async () => {
  const bridge = installBridge();
  bridge.sendPrompt.mockResolvedValueOnce({ ok: false, code: 'SESSION_NOT_READY' });
  const n = net();
  show();
  await press('Guide me');
  expect(await screen.findByRole('dialog', { name: 'Guide me' })).toBeTruthy();
  expect(results(n)).toEqual([{ ok: false, code: 'SESSION_NOT_READY' }]);
  await press('Retry');
  await waitFor(() => expect(bridge.sendPrompt).toHaveBeenCalledTimes(2));
  expect(n.count('POST api/reviews/r-1/guide')).toBe(1);
});

test('standalone: shows the prompt with Copy and Mark as sent, which records ok', async () => {
  const n = net();
  show();
  await press('Guide me');
  expect((await screen.findByLabelText('Prompt') as HTMLTextAreaElement).value).toBe('please group the round');
  expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
  await press('Mark as sent');
  await waitFor(() => expect(results(n)).toEqual([{ ok: true }]));
});

test('no recipient opens the recipient picker without composing', async () => {
  const n = net();
  show({ review: review({ recipient: null }) });
  await press('Guide me');
  expect(await screen.findByRole('dialog', { name: 'Recipient' })).toBeTruthy();
  expect(n.count('POST api/reviews/r-1/guide')).toBe(0);
});

test('a NO_RECIPIENT refusal opens the recipient picker', async () => {
  stubFetch({ 'POST api/reviews/r-1/guide': () => new Response(JSON.stringify({ ok: false, code: 'NO_RECIPIENT', reason: 'x' }), { status: 409 }) });
  show();
  await press('Guide me');
  expect(await screen.findByRole('dialog', { name: 'Recipient' })).toBeTruthy();
});

test('the header\'s Re-send banner names a guide submission', () => {
  installBridge();
  net();
  renderInReview(<SubmitControls onNoRecipient={vi.fn()} />, {
    review: review({ lastSubmission: { id: 7, kind: 'guide', status: 'failed', code: 'SESSION_NOT_READY', round: 1 } }),
    submissions: [{ ...sub, status: 'failed' }] as never,
  });
  expect(screen.getByText('Last Guide me request failed (SESSION_NOT_READY)')).toBeTruthy();
});
