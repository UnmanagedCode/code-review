import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { useState } from 'react';
import { expect, test, vi } from 'vitest';
import type { DiffFile, Verdict } from '@/lib/types';
import { ReviewProvider } from '@/state/reviewContext';
import { diffFile, hunk, refusal, review } from '@/test/fixtures';
import { ctxValue, renderInReview } from '@/test/renderCtx';
import { stubFetch } from '@/test/stubFetch';
import { FileVerdict } from './FileVerdict';

const URL_ = 'POST api/reviews/r-1/accept-file';
const file = (...verdicts: Verdict[]) => diffFile({ hunks: verdicts.map((verdict, i) => hunk({ id: `h${i + 1}`, verdict })) });
const button = () => screen.getByRole('button', { name: 'Accept file' }) as HTMLButtonElement;

test('Accept file posts the file path and only the pending hunk ids, flipping them optimistically', async () => {
  const net = stubFetch({ [URL_]: { file: 'src/a.ts', accepted: ['h1', 'h3'], review: review({ rev: 2 }) } });
  const { value } = renderInReview(<FileVerdict file={file('pending', 'rejected', 'pending', 'accepted')} />);
  await userEvent.setup().click(button());
  expect(vi.mocked(value.fileDiff.patchVerdict).mock.calls).toEqual([['h1', 'accepted'], ['h3', 'accepted']]);
  await waitFor(() => expect(net.calls[0].body).toEqual({ file: 'src/a.ts', hunkIds: ['h1', 'h3'] }));
  await waitFor(() => expect(value.applyReview).toHaveBeenCalledWith(review({ rev: 2 })));
  expect(value.reload).toHaveBeenCalled();
});

// Every refusal reloads, stale or not: the revert may have clobbered a per-hunk verdict set while the request was in flight.
test.each([
  ['REVIEW_CLOSED', 409, 'The review is closed; reopen it to change it'],
  ['HUNK_UNKNOWN', 404, 'The diff changed under you; reloaded'],
])('a refused accept (%s) reverts every flipped hunk to pending, toasts and reloads', async (code, status, text) => {
  const error = vi.spyOn(toast, 'error').mockImplementation(() => '');
  stubFetch({ [URL_]: refusal(code, status) });
  const { value } = renderInReview(<FileVerdict file={file('pending', 'pending')} />);
  await userEvent.setup().click(button());
  await waitFor(() => expect(error).toHaveBeenCalledWith(text));
  expect(vi.mocked(value.fileDiff.patchVerdict).mock.calls).toEqual([['h1', 'accepted'], ['h2', 'accepted'], ['h1', 'pending'], ['h2', 'pending']]);
  expect(value.reload).toHaveBeenCalledTimes(1);
  expect(value.applyReview).not.toHaveBeenCalled();
});

test('shows a/n accepted and r rejected; disabled when only rejected hunks remain', () => {
  const { unmount } = renderInReview(<FileVerdict file={file('accepted', 'rejected', 'pending')} />);
  expect(screen.getByText('1/3 accepted · 1 rejected')).toBeTruthy();
  expect(button().disabled).toBe(false);
  unmount();
  renderInReview(<FileVerdict file={file('accepted', 'rejected')} />);
  expect(screen.getByText('1/2 accepted · 1 rejected')).toBeTruthy();
  expect(button().disabled).toBe(true);
});

test('every hunk accepted reads All accepted with no Accept file button', () => {
  renderInReview(<FileVerdict file={file('accepted', 'accepted')} />);
  expect(screen.getByText('2/2 accepted')).toBeTruthy();
  expect(screen.getByText('All accepted')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Accept file' })).toBeNull();
});

test('no control on uncommitted reviews or the commit-filter view; disabled on a closed review', () => {
  const a = renderInReview(<FileVerdict file={file('pending')} />, { review: review({ kind: 'uncommitted' }) });
  expect(a.container.firstChild).toBeNull();
  a.unmount();
  const b = renderInReview(<FileVerdict file={file('pending')} />, { commit: 'abc1234', readOnly: true });
  expect(b.container.firstChild).toBeNull();
  b.unmount();
  renderInReview(<FileVerdict file={file('pending')} />, { review: review({ status: 'closed' }) });
  expect(button().disabled).toBe(true);
});

test('a binary file\'s single file-level hunk can be accepted', async () => {
  const net = stubFetch({ [URL_]: { file: 'img.png', accepted: ['f1'], review: review() } });
  const bin = diffFile({ path: 'img.png', binary: true, hunks: [{ id: 'f1', kind: 'file', lines: [], verdict: 'pending' }] });
  renderInReview(<FileVerdict file={bin} />);
  expect(screen.getByText('0/1 accepted')).toBeTruthy();
  await userEvent.setup().click(button());
  await waitFor(() => expect(net.calls[0].body).toEqual({ file: 'img.png', hunkIds: ['f1'] }));
});

// A harness whose patchVerdict really updates the file, so the header shows what the UI shows.
function Stateful() {
  const [f, setF] = useState<DiffFile>(file('pending', 'rejected', 'pending'));
  const patchVerdict = (id: string, verdict: Verdict) => setF((x) => ({ ...x, hunks: x.hunks.map((h) => (h.id === id ? { ...h, verdict } : h)) }));
  const value = ctxValue({ fileDiff: { patchVerdict } as never });
  return <ReviewProvider value={value}><FileVerdict file={f} /></ReviewProvider>;
}

test('the header updates before the server answers', async () => {
  stubFetch({ [URL_]: () => new Promise(() => {}) });
  render(<Stateful />);
  expect(screen.getByText('0/3 accepted · 1 rejected')).toBeTruthy();
  await userEvent.setup().click(button());
  expect(screen.getByText('2/3 accepted · 1 rejected')).toBeTruthy();
  expect(button().disabled).toBe(true);
});

test('no Accept file in the past-round view', () => {
  const { container } = renderInReview(<FileVerdict file={file('pending')} />, { round: 1, readOnly: true });
  expect(container.firstChild).toBeNull();
});
