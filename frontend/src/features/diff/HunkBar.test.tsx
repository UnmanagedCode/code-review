import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { useState } from 'react';
import { expect, test, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ReviewProvider } from '@/state/reviewContext';
import { hunk, refusal, review } from '@/test/fixtures';
import { ctxValue, renderInReview } from '@/test/renderCtx';
import { stubFetch } from '@/test/stubFetch';
import { HunkBar } from './HunkBar';

const ok = (verdict: string) => ({ hunkId: 'h1', verdict, review: review({ rev: 2 }), fileSig: { path: 'src/a.ts', sig: 's-2' } });

test.each([['Accept', 'accepted'], ['Reject', 'rejected']])('%s issues PUT …/verdict with that verdict, optimistically', async (label, verdict) => {
  const net = stubFetch({ 'PUT api/reviews/r-1/hunks/h1/verdict': ok(verdict) });
  const { value } = renderInReview(<HunkBar hunk={hunk()} commentable />);
  await userEvent.setup().click(screen.getByRole('button', { name: label }));
  expect(value.fileDiff.patchVerdict).toHaveBeenCalledWith('h1', verdict);
  await waitFor(() => expect(net.calls[0].body).toEqual({ verdict }));
});

test('Pending clears an existing verdict', async () => {
  const net = stubFetch({ 'PUT api/reviews/r-1/hunks/h1/verdict': ok('pending') });
  renderInReview(<HunkBar hunk={hunk({ verdict: 'accepted' })} commentable />);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Pending' }));
  await waitFor(() => expect(net.calls[0].body).toEqual({ verdict: 'pending' }));
});

test('a refused verdict reverts the optimistic flip and toasts the refusal', async () => {
  const error = vi.spyOn(toast, 'error').mockImplementation(() => '');
  stubFetch({ 'PUT api/reviews/r-1/hunks/h1/verdict': refusal('REVIEW_CLOSED') });
  const { value } = renderInReview(<HunkBar hunk={hunk({ verdict: 'pending' })} commentable />);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Accept' }));
  await waitFor(() => expect(error).toHaveBeenCalledWith('The review is closed; reopen it to change it'));
  expect(vi.mocked(value.fileDiff.patchVerdict).mock.calls).toEqual([['h1', 'accepted'], ['h1', 'pending']]);
});

test('uncommitted reviews show no verdict controls but keep Comment on hunk', () => {
  renderInReview(<HunkBar hunk={hunk({ verdict: null })} commentable />, { review: review({ kind: 'uncommitted' }) });
  expect(screen.queryByRole('group', { name: 'Hunk verdict' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Comment on hunk' })).toBeTruthy();
});

test('a file-level hunk gets the verdict but no comment button', () => {
  renderInReview(<HunkBar hunk={{ id: 'f', kind: 'file', lines: [], verdict: 'pending' }} commentable={false} />);
  expect(screen.getByRole('group', { name: 'Hunk verdict' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Comment on hunk' })).toBeNull();
});

test('the commit-filter view renders no bar at all', () => {
  const { container } = renderInReview(<HunkBar hunk={hunk()} commentable />, { commit: 'abc1234', readOnly: true });
  expect(container.firstChild).toBeNull();
});

test('Comment on hunk opens the composer anchored by {hunkId}', async () => {
  const net = stubFetch({ 'POST api/reviews/r-1/threads': { thread: { id: 't-1' }, fileSig: { path: 'src/a.ts', sig: 's-2' } } });
  const user = userEvent.setup();
  renderInReview(<HunkBar hunk={hunk()} commentable />);
  await user.click(screen.getByRole('button', { name: 'Comment on hunk' }));
  await user.selectOptions(screen.getByLabelText('Kind'), 'question');
  await user.type(screen.getByLabelText('Message'), 'why');
  await user.click(screen.getByRole('button', { name: 'Post' }));
  await waitFor(() => expect(net.calls[0].body).toEqual({ anchor: { hunkId: 'h1' }, kind: 'question', body: 'why' }));
});

// A harness whose patchVerdict really updates the hunk, so the pressed state reflects what the UI shows.
function Stateful() {
  const [h, setH] = useState(hunk({ verdict: 'pending' }));
  const value = ctxValue({ fileDiff: { patchVerdict: (_id: string, verdict: never) => setH((x) => ({ ...x, verdict })) } as never });
  return <ReviewProvider value={value}><HunkBar hunk={h} commentable /></ReviewProvider>;
}
const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed');

test('the verdict toggle flips before the server answers', async () => {
  stubFetch({ 'PUT api/reviews/r-1/hunks/h1/verdict': () => new Promise(() => {}) });
  render(<Stateful />);
  expect(pressed('Pending')).toBe('true');
  await userEvent.setup().click(screen.getByRole('button', { name: 'Accept' }));
  expect(pressed('Accept')).toBe('true');
  expect(pressed('Pending')).toBe('false');
});

test('after a refusal the toggle is back on its previous verdict', async () => {
  vi.spyOn(toast, 'error').mockImplementation(() => '');
  stubFetch({ 'PUT api/reviews/r-1/hunks/h1/verdict': refusal('REVIEW_CLOSED') });
  render(<Stateful />);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Accept' }));
  await waitFor(() => expect(pressed('Pending')).toBe('true'));
  expect(pressed('Accept')).toBe('false');
});

// Pins: exactly one segment is active, and a null verdict counts as Pending.
test.each([['accepted', 'Accept'], ['rejected', 'Reject'], ['pending', 'Pending'], [null, 'Pending']] as const)('verdict %s marks only %s as the active segment', (verdict, label) => {
  renderInReview(<HunkBar hunk={hunk({ verdict })} commentable />);
  for (const name of ['Accept', 'Reject', 'Pending']) expect(pressed(name)).toBe(String(name === label));
});

// Pins: a closed review still shows which verdict is active, but no segment can change it.
test('a closed review keeps the active segment marked but disables every segment', () => {
  renderInReview(<HunkBar hunk={hunk({ verdict: 'rejected' })} commentable />, { review: review({ status: 'closed' }) });
  expect(pressed('Reject')).toBe('true');
  for (const name of ['Accept', 'Reject', 'Pending']) expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
});

// Pins: the active-verdict tint is keyed on aria-pressed; each verdict has its own hue in the background only, with neutral
// text (a hued label misses AA contrast). The dark hover shade is required (ghost's dark hover out-specifies the plain
// background); the light one is an affordance. No other verdict's hue and no primary tint.
const HUES = { Accept: 'success', Reject: 'destructive', Pending: 'info' } as const;
test.each(Object.entries(HUES))('the %s segment carries its own aria-pressed hue (%s) in the background, neutral text, both hover shades, and no other tint', (name, hue) => {
  renderInReview(<HunkBar hunk={hunk()} commentable />);
  const { className } = screen.getByRole('button', { name });
  expect(className).toMatch(new RegExp(`\\baria-pressed:bg-${hue}/\\d+\\b`));
  expect(className).toMatch(new RegExp(`(^|\\s)aria-pressed:hover:bg-${hue}/\\d+\\b`));
  expect(className).toMatch(new RegExp(`(^|\\s)dark:aria-pressed:hover:bg-${hue}/\\d+\\b`));
  expect(className).toMatch(/(^|\s)aria-pressed:text-foreground\b/);
  expect(className).not.toMatch(new RegExp(`\\baria-pressed:(hover:)?text-(${Object.values(HUES).join('|')}|primary)\\b`));
  for (const other of Object.values(HUES).filter((h) => h !== hue)) expect(className).not.toMatch(new RegExp(`-${other}\\b`));
  expect(className).not.toMatch(/\bbg-primary\b/);
});

test('the past-round view renders no bar at all', () => {
  const { container } = renderInReview(<HunkBar hunk={hunk()} commentable />, { round: 1, readOnly: true });
  expect(container.firstChild).toBeNull();
});
