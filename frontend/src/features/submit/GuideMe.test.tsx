import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { installBridge } from '@/test/fakeBridge';
import { refusal, review } from '@/test/fixtures';
import { sampleGuide } from '@/test/guideWorld';
import { ctxValue, renderInReview } from '@/test/renderCtx';
import { resetInFlight } from '@/state/submit';
import { ReviewProvider } from '@/test/reviewProvider';
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

test('while a Guide me delivery is in flight the header shows no Re-send banner; after a closed standalone copy dialog it does', async () => {
  // Invariant: the "not recorded as delivered" banner is a true signal only: a send this page is still making is not a loose end.
  const bridge = installBridge();
  bridge.sendPrompt.mockReturnValue(new Promise(() => {}));
  net();
  const user = userEvent.setup();
  const ui = (over: object) => {
    const value = ctxValue({ guide: sampleGuide({ guideMe: OFFER }), ...over });
    return <ReviewProvider value={value}><SubmitControls onNoRecipient={() => {}} /><GuideMeButton /></ReviewProvider>;
  };
  const { rerender, unmount } = render(ui({}));
  await user.click(screen.getByRole('button', { name: 'Guide me' }));
  await waitFor(() => expect(bridge.sendPrompt).toHaveBeenCalled());
  // The compose's SSE echo: the review now reports the guide submission as pending.
  rerender(ui({
    review: review({ lastSubmission: { id: 7, kind: 'guide', status: 'pending', code: null, round: 1 } }),
    submissions: [sub] as never,
  }));
  expect(screen.queryByText(/isn’t recorded as delivered/)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Re-send' })).toBeNull();
  unmount();
  resetInFlight(); // the never-answering send above stands in for one that has ended

  // Standalone: the copy dialog is closed with delivery unknown, so the banner is truthful.
  delete window.ccBridge;
  const second = render(ui({
    review: review({ lastSubmission: { id: 7, kind: 'round', status: 'pending', code: null, round: 1 } }),
    submissions: [{ ...sub, kind: 'round' }] as never,
  }));
  expect(screen.getByText('Last submission isn’t recorded as delivered')).toBeTruthy();
  second.unmount();
});

test('no Re-send banner while a delivered Guide me prompt\u2019s result is still being recorded; if recording fails the banner returns', async () => {
  // Invariant: a submission stays in flight until its outcome is recorded, not merely until the bridge answers.
  installBridge();
  let finish!: (r: Response) => void;
  const held = new Promise<Response>((res) => { finish = res; });
  stubFetch({
    'POST api/reviews/r-1/guide': { submission: sub },
    'POST api/reviews/r-1/submissions/7/result': () => held,
  });
  const user = userEvent.setup();
  const ui = (over: object) => (
    <ReviewProvider value={ctxValue({ guide: sampleGuide({ guideMe: OFFER }), ...over })}><SubmitControls onNoRecipient={() => {}} /><GuideMeButton /></ReviewProvider>
  );
  const { rerender } = render(ui({}));
  await user.click(screen.getByRole('button', { name: 'Guide me' }));
  await waitFor(() => expect(window.ccBridge!.sendPrompt).toHaveBeenCalled());
  // The bridge has answered ok; the result POST is still pending, and the review reports the guide submission pending.
  rerender(ui({ review: review({ lastSubmission: { id: 7, kind: 'guide', status: 'pending', code: null, round: 1 } }), submissions: [sub] as never }));
  expect(screen.queryByRole('button', { name: 'Re-send' })).toBeNull();
  await act(async () => { finish(refusal('HOST_ERROR', 500)); await held; });
  expect(await screen.findByRole('button', { name: 'Re-send' })).toBeTruthy();
});
