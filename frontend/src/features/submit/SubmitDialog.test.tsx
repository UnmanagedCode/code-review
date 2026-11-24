import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { expect, test, vi } from 'vitest';
import { parseRoute } from '@/lib/route';
import { BRIDGE_CODES, bridgeMessage } from '@/lib/refusals';
import { installBridge } from '@/test/fakeBridge';
import { refusal, review } from '@/test/fixtures';
import { renderInReview } from '@/test/renderCtx';
import { stubFetch } from '@/test/stubFetch';
import { SubmitControls } from './SubmitControls';

const sub = { id: 3, round: 1, recipient: 's-author', text: 'please review', status: 'pending' };
export const recap = (over = {}) => ({
  round: 1, kind: 'range', nothingToSubmit: false, hunks: { accepted: 1, rejected: 0, pending: 0 }, undecided: [], files: null,
  outgoing: [], needsYou: [], waiting: 0, text: 'PREVIEW TEXT', ...over,
});
const net = (rc: object = recap()) => stubFetch({
  'POST api/reviews/r-1/submissions/preview': (_u: URL, init?: RequestInit) => ({ recap: { ...rc, text: `${(rc as { text: string }).text} ${(JSON.parse(String(init?.body ?? '{}')).note ?? '')}`.trim() } }),
  'POST api/reviews/r-1/submissions': { submission: sub },
  'POST api/reviews/r-1/submissions/3/result': { submission: { ...sub, status: 'delivered' } },
});
const results = (n: ReturnType<typeof stubFetch>) => n.calls.filter((c) => c.url.pathname.endsWith('/result')).map((c) => c.body);
const press = (name: string | RegExp) => userEvent.setup().click(screen.getByRole('button', { name }));
/** Submit round, then confirm in the recap (Send to … with a bridge, Compose prompt without). */
const submitRound = async () => {
  await press('Submit round');
  await userEvent.setup().click(await screen.findByRole('button', { name: /^(Send to|Compose prompt)/ }));
};

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
  await submitRound();
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
  await submitRound();
  await waitFor(() => expect(results(n)).toEqual([{ ok: true }]));
  expect(bridge.sendPrompt).toHaveBeenCalledWith('s-author', 'please review');
});

test('an unrecognised bridge code posts nothing and shows the raw code with the usual actions', async () => {
  const bridge = installBridge();
  bridge.sendPrompt.mockResolvedValue({ ok: false, code: 'BRAND_NEW' });
  const n = net();
  renderInReview(<SubmitControls onNoRecipient={() => {}} />);
  await submitRound();
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
  await act(() => vi.advanceTimersByTimeAsync(0));
  fireEvent.click(screen.getByRole('button', { name: /^Send to/ }));
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
  await user.click(await screen.findByRole('button', { name: 'Compose prompt' }));
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
  await user.click(await screen.findByRole('button', { name: 'Compose prompt' }));
  await screen.findByLabelText('Prompt');
  await user.click(screen.getByRole('button', { name: 'Copy' }));
  await waitFor(() => expect(info).toHaveBeenCalledWith('Press Ctrl/Cmd+C to copy'));
});

test('NO_RECIPIENT opens the picker; NOTHING_TO_SUBMIT toasts info', async () => {
  const info = vi.spyOn(toast, 'info').mockImplementation(() => '');
  let opened = 0;
  stubFetch({ 'POST api/reviews/r-1/submissions/preview': { recap: recap() }, 'POST api/reviews/r-1/submissions': refusal('NO_RECIPIENT') });
  const { unmount } = renderInReview(<SubmitControls onNoRecipient={() => { opened++; }} />);
  await submitRound();
  await waitFor(() => expect(opened).toBe(1));
  unmount();
  stubFetch({ 'POST api/reviews/r-1/submissions/preview': { recap: recap() }, 'POST api/reviews/r-1/submissions': refusal('NOTHING_TO_SUBMIT') });
  renderInReview(<SubmitControls onNoRecipient={() => { opened++; }} />);
  await submitRound();
  await waitFor(() => expect(info).toHaveBeenCalled());
  expect(opened).toBe(1);
});

test('a submission left failed after a reload is offered for re-send', async () => {
  const bridge = installBridge();
  const n = net();
  renderInReview(<SubmitControls onNoRecipient={() => {}} />, {
    review: review({ lastSubmission: { id: 3, kind: 'round', status: 'failed', code: 'SESSION_NOT_READY', round: 1 } }),
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
    review: review({ lastSubmission: { id: 3, kind: 'round', status: 'pending', code: null, round: 1 } }),
    submissions: [sub] as never,
  });
  expect(screen.getByText('Last submission isn’t recorded as delivered')).toBeTruthy();
  const resend = screen.getByRole('button', { name: 'Re-send' });
  const warning = document.getElementById(resend.getAttribute('aria-describedby')!)!;
  expect(warning.textContent).toMatch(/may already have reached the session.*twice/);
});

const range = () => parseRoute(location.search);
const placed = { id: 't2', kind: 'question', where: 'a.js#L8', status: 'open', note: 'why', anchor: { kind: 'lines', file: 'a.js', side: 'new', startLine: 8, endLine: 8, round: 1 } };

test('Submit round opens the recap and composes or sends nothing until Send', async () => {
  // Invariant: no side effects before the human confirms.
  const bridge = installBridge();
  const n = net();
  renderInReview(<SubmitControls onNoRecipient={() => {}} />);
  await press('Submit round');
  expect(await screen.findByRole('list', { name: 'What this round sends' })).toBeTruthy();
  expect(n.count('POST api/reviews/r-1/submissions')).toBe(0);
  expect(bridge.sendPrompt).not.toHaveBeenCalled();
});

test('Send composes with the typed note and delivers through the bridge; the recap closes on delivery', async () => {
  const bridge = installBridge();
  const n = net();
  renderInReview(<SubmitControls onNoRecipient={() => {}} />);
  await press('Submit round');
  await userEvent.setup().type(await screen.findByLabelText('Overall note'), 'looks close');
  await press(/^Send to/);
  await waitFor(() => expect(results(n)).toEqual([{ ok: true }]));
  expect(n.calls.find((c) => c.url.pathname.endsWith('/submissions') && c.method === 'POST')!.body).toEqual({ note: 'looks close' });
  expect(bridge.sendPrompt).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

test('undecided hunks show a warning row but Send stays enabled', async () => {
  // Invariant: a partial round is never blocked.
  installBridge();
  net(recap({ hunks: { accepted: 1, rejected: 0, pending: 3 }, undecided: [{ id: 'h1', path: 'a.js', side: 'new', line: 3 }] }));
  renderInReview(<SubmitControls onNoRecipient={() => {}} />);
  await press('Submit round');
  expect(await screen.findByText('3 hunks undecided')).toBeTruthy();
  expect((screen.getByRole('button', { name: /^Send to/ }) as HTMLButtonElement).disabled).toBe(false);
});

test('with nothingToSubmit, Send is disabled until a note is typed', async () => {
  installBridge();
  net(recap({ nothingToSubmit: true }));
  renderInReview(<SubmitControls onNoRecipient={() => {}} />);
  await press('Submit round');
  const send = await screen.findByRole('button', { name: /^Send to/ }) as HTMLButtonElement;
  expect(await screen.findByText(/Nothing new since round 1 was sent/)).toBeTruthy();
  expect(send.disabled).toBe(true);
  await userEvent.setup().type(screen.getByLabelText('Overall note'), 'x');
  expect(send.disabled).toBe(false);
});

test('without a bridge the primary reads Compose prompt and leads to the copy dialog with Copy and Mark as sent', async () => {
  net();
  renderInReview(<SubmitControls onNoRecipient={() => {}} />);
  await press('Submit round');
  expect(screen.queryByRole('button', { name: /^Send to/ })).toBeNull();
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Compose prompt' }));
  expect(await screen.findByLabelText('Prompt')).toBeTruthy();
  for (const name of ['Copy', 'Mark as sent']) expect(screen.getByRole('button', { name })).toBeTruthy();
  expect(screen.queryByLabelText('Overall note')).toBeNull();
});

test('a failed send from the recap shows Retry and Copy prompt, and Retry reuses the same submission', async () => {
  const bridge = installBridge();
  bridge.sendPrompt.mockResolvedValueOnce({ ok: false, code: 'SESSION_NOT_READY' });
  const n = net();
  renderInReview(<SubmitControls onNoRecipient={() => {}} />);
  await submitRound();
  expect(await screen.findByRole('button', { name: 'Copy prompt' })).toBeTruthy();
  await press('Retry');
  await waitFor(() => expect(results(n)).toEqual([{ ok: false, code: 'SESSION_NOT_READY' }, { ok: true }]));
  expect(n.count('POST api/reviews/r-1/submissions')).toBe(1);
});

test('Review them closes the recap and routes to the first undecided hunk’s file and line; reopening keeps the note', async () => {
  // Invariant: navigation works from the recap and the typed note survives it.
  net(recap({ hunks: { accepted: 0, rejected: 0, pending: 2 }, undecided: [{ id: 'h1', path: 'src/a.js', side: 'new', line: 7 }, { id: 'h2', path: 'b.js', side: 'new', line: 1 }] }));
  renderInReview(<SubmitControls onNoRecipient={() => {}} />);
  await press('Submit round');
  await userEvent.setup().type(await screen.findByLabelText('Overall note'), 'keep me');
  await press('Review them');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(range()).toMatchObject({ file: 'src/a.js', side: 'new', lines: '7' });
  await press('Submit round');
  expect((await screen.findByLabelText('Overall note') as HTMLTextAreaElement).value).toBe('keep me');
});

test('Answer first routes to the first needs-you thread’s place', async () => {
  net(recap({ needsYou: [{ ...placed, id: 't9', anchor: { kind: 'review', round: 1 } }] }));
  renderInReview(<SubmitControls onNoRecipient={() => {}} />);
  await press('Submit round');
  await press('Answer first');
  expect(range()).toMatchObject({ view: 'threads', thread: 't9' });
});

test('the prompt preview is collapsed by default and, when expanded, shows the text fetched with the current note after the debounce', async () => {
  // Invariant: the preview is the server's rendering of the current note, fetched only on demand.
  net();
  renderInReview(<SubmitControls onNoRecipient={() => {}} />);
  await press('Submit round');
  const toggle = await screen.findByRole('button', { name: /Preview the prompt/ });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByLabelText('Prompt preview')).toBeNull();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  fireEvent.change(screen.getByLabelText('Overall note'), { target: { value: 'hi there' } });
  fireEvent.click(toggle);
  await act(() => vi.advanceTimersByTimeAsync(400));
  vi.useRealTimers();
  await waitFor(() => expect(screen.getByLabelText('Prompt preview').textContent).toBe('PREVIEW TEXT hi there'));
});

test('a NO_RECIPIENT recap refusal opens the recipient picker', async () => {
  let opened = 0;
  stubFetch({ 'POST api/reviews/r-1/submissions/preview': refusal('NO_RECIPIENT') });
  renderInReview(<SubmitControls onNoRecipient={() => { opened++; }} />);
  await press('Submit round');
  await waitFor(() => expect(opened).toBe(1));
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('Re-send from the banner delivers without opening the recap', async () => {
  // Invariant: a re-send is not a new round: no recap step.
  const bridge = installBridge();
  const n = net();
  renderInReview(<SubmitControls onNoRecipient={() => {}} />, {
    review: review({ lastSubmission: { id: 3, kind: 'round', status: 'failed', code: 'SESSION_NOT_READY', round: 1 } }),
    submissions: [{ ...sub, status: 'failed' }] as never,
  });
  await press('Re-send');
  await waitFor(() => expect(bridge.sendPrompt).toHaveBeenCalled());
  expect(n.count('POST api/reviews/r-1/submissions/preview')).toBe(0);
  expect(screen.queryByLabelText('Overall note')).toBeNull();
});

test('the prompt preview is collapsed again when the recap is closed and reopened', async () => {
  // Invariant: each recap opens collapsed; the preview never carries over.
  net();
  renderInReview(<SubmitControls onNoRecipient={() => {}} />);
  await press('Submit round');
  await userEvent.setup().click(await screen.findByRole('button', { name: /Preview the prompt/ }));
  expect(await screen.findByLabelText('Prompt preview')).toBeTruthy();
  await press('Cancel');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await press('Submit round');
  const toggle = await screen.findByRole('button', { name: /Preview the prompt/ });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByLabelText('Prompt preview')).toBeNull();
});
