import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { expect, test, vi } from 'vitest';
import { BRIDGE_CODES, bridgeMessage } from '@/lib/refusals';
import { installBridge } from '@/test/fakeBridge';
import { refusal, review } from '@/test/fixtures';
import { renderInReview } from '@/test/renderCtx';
import { stubFetch } from '@/test/stubFetch';
import { SubmitControls } from './SubmitControls';

const sub = { id: 3, round: 1, recipient: 's-author', text: 'please review', status: 'pending' };
const net = () => stubFetch({
  'POST api/reviews/r-1/submissions': { submission: sub },
  'POST api/reviews/r-1/submissions/3/result': { submission: { ...sub, status: 'delivered' } },
});
const results = (n: ReturnType<typeof stubFetch>) => n.calls.filter((c) => c.url.pathname.endsWith('/result')).map((c) => c.body);
const press = (name: string | RegExp) => userEvent.setup().click(screen.getByRole('button', { name }));

test('the button reads Submit round for range reviews and Request review for uncommitted ones', () => {
  const { unmount } = renderInReview(<SubmitControls onNoRecipient={() => {}} />);
  expect(screen.getByRole('button', { name: 'Submit round' })).toBeTruthy();
  unmount();
  renderInReview(<SubmitControls onNoRecipient={() => {}} />, { review: review({ kind: 'uncommitted' }) });
  expect(screen.getByRole('button', { name: 'Request review' })).toBeTruthy();
});

test('a closed review disables submitting', () => {
  renderInReview(<SubmitControls onNoRecipient={() => {}} />, { review: review({ status: 'closed' }) });
  expect((screen.getByRole('button', { name: 'Submit round' }) as HTMLButtonElement).disabled).toBe(true);
});

test.each(BRIDGE_CODES)('bridge code %s: recorded, its message shown, Retry posts to the same submission', async (code) => {
  const bridge = installBridge();
  bridge.sendPrompt.mockResolvedValueOnce({ ok: false, code });
  const n = net();
  renderInReview(<SubmitControls onNoRecipient={() => {}} />);
  await press('Submit round');
  expect(await screen.findByText(bridgeMessage(code))).toBeTruthy();
  expect(results(n)).toEqual([{ ok: false, code }]);
  await press('Retry');
  await waitFor(() => expect(results(n)).toEqual([{ ok: false, code }, { ok: true }]));
  expect(n.count('POST api/reviews/r-1/submissions')).toBe(1);
});

test('bridge ok sends to the recipient and records success', async () => {
  const bridge = installBridge();
  const n = net();
  renderInReview(<SubmitControls onNoRecipient={() => {}} />);
  await press('Submit round');
  await waitFor(() => expect(results(n)).toEqual([{ ok: true }]));
  expect(bridge.sendPrompt).toHaveBeenCalledWith('s-author', 'please review');
});

test('an unrecognised bridge code posts nothing and shows the raw code with the usual actions', async () => {
  const bridge = installBridge();
  bridge.sendPrompt.mockResolvedValue({ ok: false, code: 'BRAND_NEW' });
  const n = net();
  renderInReview(<SubmitControls onNoRecipient={() => {}} />);
  await press('Submit round');
  expect(await screen.findByText(/BRAND_NEW/)).toBeTruthy();
  expect(results(n)).toEqual([]);
  for (const name of ['Retry', 'Open agent', 'Copy prompt', 'Mark as sent']) expect(screen.getByRole('button', { name })).toBeTruthy();
});

test('past the deadline nothing is posted, and Retry warns the prompt may already have arrived', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const bridge = installBridge();
  bridge.sendPrompt.mockReturnValue(new Promise(() => {}));
  const n = net();
  renderInReview(<SubmitControls onNoRecipient={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Submit round' }));
  await act(() => vi.advanceTimersByTimeAsync(25_000));
  expect(screen.getByText(/cc didn’t answer/)).toBeTruthy();
  expect(results(n)).toEqual([]);
  const retry = screen.getByRole('button', { name: 'Retry anyway' });
  const warning = document.getElementById(retry.getAttribute('aria-describedby')!)!;
  expect(warning.textContent).toMatch(/may already have arrived.*twice/);
  expect(screen.getByRole('button', { name: 'Copy prompt' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Mark as sent' })).toBeTruthy();
});

test('without a bridge the prompt is shown; Copy writes it to the clipboard; Mark as sent records ok', async () => {
  const user = userEvent.setup();
  const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
  const n = net();
  renderInReview(<SubmitControls onNoRecipient={() => {}} />);
  await user.click(screen.getByRole('button', { name: 'Submit round' }));
  expect((await screen.findByLabelText('Prompt') as HTMLTextAreaElement).value).toBe('please review');
  expect(screen.queryByRole('button', { name: 'Open agent' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Copy' }));
  expect(write).toHaveBeenCalledWith('please review');
  await user.click(screen.getByRole('button', { name: 'Mark as sent' }));
  await waitFor(() => expect(results(n)).toEqual([{ ok: true }]));
});

test('a failed clipboard write selects the text and tells the user to copy by hand', async () => {
  const info = vi.spyOn(toast, 'info').mockImplementation(() => '');
  const user = userEvent.setup();
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
  net();
  renderInReview(<SubmitControls onNoRecipient={() => {}} />);
  await user.click(screen.getByRole('button', { name: 'Submit round' }));
  await screen.findByLabelText('Prompt');
  await user.click(screen.getByRole('button', { name: 'Copy' }));
  await waitFor(() => expect(info).toHaveBeenCalledWith('Press Ctrl/Cmd+C to copy'));
});

test('NO_RECIPIENT opens the picker; NOTHING_TO_SUBMIT toasts info', async () => {
  const info = vi.spyOn(toast, 'info').mockImplementation(() => '');
  let opened = 0;
  stubFetch({ 'POST api/reviews/r-1/submissions': refusal('NO_RECIPIENT') });
  const { unmount } = renderInReview(<SubmitControls onNoRecipient={() => { opened++; }} />);
  await press('Submit round');
  await waitFor(() => expect(opened).toBe(1));
  unmount();
  stubFetch({ 'POST api/reviews/r-1/submissions': refusal('NOTHING_TO_SUBMIT') });
  renderInReview(<SubmitControls onNoRecipient={() => { opened++; }} />);
  await press('Submit round');
  await waitFor(() => expect(info).toHaveBeenCalled());
  expect(opened).toBe(1);
});

test('a submission left failed after a reload is offered for re-send', async () => {
  const bridge = installBridge();
  const n = net();
  renderInReview(<SubmitControls onNoRecipient={() => {}} />, {
    review: review({ lastSubmission: { id: 3, status: 'failed', code: 'SESSION_NOT_READY', round: 1 } }),
    submissions: [{ ...sub, status: 'failed' }] as never,
  });
  expect(screen.getByText('Last submission failed (SESSION_NOT_READY)')).toBeTruthy();
  // A failed submission's delivery is known (the bridge refused it), so no double-delivery warning.
  expect(screen.queryByText(/twice/)).toBeNull();
  expect(screen.getByRole('button', { name: 'Re-send' }).getAttribute('aria-describedby')).toBeNull();
  await press('Re-send');
  await waitFor(() => expect(results(n)).toEqual([{ ok: true }]));
  expect(bridge.sendPrompt).toHaveBeenCalledWith('s-author', 'please review');
});

test('a submission left pending is offered for re-send, worded as unrecorded and warning of a double delivery', () => {
  installBridge();
  net();
  renderInReview(<SubmitControls onNoRecipient={() => {}} />, {
    review: review({ lastSubmission: { id: 3, status: 'pending', code: null, round: 1 } }),
    submissions: [sub] as never,
  });
  expect(screen.getByText('Last submission isn’t recorded as delivered')).toBeTruthy();
  const resend = screen.getByRole('button', { name: 'Re-send' });
  const warning = document.getElementById(resend.getAttribute('aria-describedby')!)!;
  expect(warning.textContent).toMatch(/may already have reached the session.*twice/);
});
