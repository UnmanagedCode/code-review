import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { useState } from 'react';
import { expect, test, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ReviewProvider } from '@/test/reviewProvider';
import { hunk, refusal, review } from '@/test/fixtures';
import { ctxValue, renderInReview } from '@/test/renderCtx';
import { stubFetch } from '@/test/stubFetch';
import { HunkBar, VerdictToggle } from './HunkBar';

const ok = (verdict: string) => ({ hunkId: 'h1', verdict, clearedGroups: [], review: review({ rev: 2 }), fileSig: { path: 'src/a.ts', sig: 's-2' } });

test.each([['Accept', 'accepted'], ['Reject', 'rejected']])('%s issues PUT …/verdict with that verdict, optimistically', async (label, verdict) => {
  const net = stubFetch({ 'PUT api/reviews/r-1/hunks/h1/verdict': ok(verdict) });
  const { value } = renderInReview(<HunkBar hunk={hunk()} path="src/a.ts" commentable />);
  await userEvent.setup().click(screen.getByRole('button', { name: label }));
  expect(value.diffs.patchVerdicts).toHaveBeenCalledWith('src/a.ts', { h1: verdict });
  await waitFor(() => expect(net.calls[0].body).toEqual({ verdict }));
});

// Invariant: an undecided hunk offers only Accept and Reject, and neither reads as chosen (no Pending segment).
test('an undecided hunk shows only Accept and Reject, neither pressed', () => {
  renderInReview(<HunkBar hunk={hunk({ verdict: 'pending' })} path="src/a.ts" commentable />);
  const group = within(screen.getByRole('group', { name: 'Hunk verdict' }));
  expect(group.getByText('undecided')).toBeTruthy();
  expect(group.getAllByRole('button').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['Accept', 'false'], ['Reject', 'false']]);
  expect(group.queryByRole('button', { name: 'Pending' })).toBeNull();
});

// Invariant: a decided hunk shows its verdict and a Clear control that sends pending optimistically; no Accept/Reject segments remain.
test.each([['accepted', '✓ Accepted'], ['rejected', '✗ Rejected']] as const)('a %s hunk shows its verdict and Clear sends pending', async (verdict, text) => {
  const net = stubFetch({ 'PUT api/reviews/r-1/hunks/h1/verdict': ok('pending') });
  const { value } = renderInReview(<HunkBar hunk={hunk({ verdict })} path="src/a.ts" commentable />);
  const group = within(screen.getByRole('group', { name: 'Hunk verdict' }));
  expect(group.getByText(text)).toBeTruthy();
  expect(group.queryByRole('button', { name: 'Accept' })).toBeNull();
  await userEvent.setup().click(group.getByRole('button', { name: 'Clear' }));
  expect(value.diffs.patchVerdicts).toHaveBeenCalledWith('src/a.ts', { h1: 'pending' });
  await waitFor(() => expect(net.calls[0].body).toEqual({ verdict: 'pending' }));
});

// Invariant: a closed review disables every verdict control of the hunk bar.
test.each(['pending', 'accepted'] as const)('a closed review disables the %s hunk’s controls', (verdict) => {
  renderInReview(<HunkBar hunk={hunk({ verdict })} path="src/a.ts" commentable />, { review: review({ status: 'closed' }) });
  const buttons = within(screen.getByRole('group', { name: 'Hunk verdict' })).getAllByRole('button');
  expect(buttons.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
});

test('a refused verdict reverts the optimistic flip and toasts the refusal', async () => {
  const error = vi.spyOn(toast, 'error').mockImplementation(() => '');
  stubFetch({ 'PUT api/reviews/r-1/hunks/h1/verdict': refusal('REVIEW_CLOSED') });
  const { value } = renderInReview(<HunkBar hunk={hunk({ verdict: 'pending' })} path="src/a.ts" commentable />);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Accept' }));
  await waitFor(() => expect(error).toHaveBeenCalledWith('The review is closed; reopen it to change it'));
  expect(vi.mocked(value.diffs.patchVerdicts).mock.calls).toEqual([['src/a.ts', { h1: 'accepted' }], ['src/a.ts', { h1: 'pending' }]]);
});

test('uncommitted reviews show no verdict controls but keep Comment on hunk', () => {
  renderInReview(<HunkBar hunk={hunk({ verdict: null })} path="src/a.ts" commentable />, { review: review({ kind: 'uncommitted' }) });
  expect(screen.queryByRole('group', { name: 'Hunk verdict' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Comment on hunk' })).toBeTruthy();
});

test('a file-level hunk gets the verdict but no comment button', () => {
  renderInReview(<HunkBar hunk={{ id: 'f', kind: 'file', lines: [], verdict: 'pending' }} path="src/a.ts" commentable={false} />);
  expect(screen.getByRole('group', { name: 'Hunk verdict' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Comment on hunk' })).toBeNull();
});

test('the commit-filter view renders no bar at all', () => {
  const { container } = renderInReview(<HunkBar hunk={hunk()} path="src/a.ts" commentable />, { commit: 'abc1234', readOnly: true });
  expect(container.firstChild).toBeNull();
});

test('Comment on hunk opens the composer anchored by {hunkId}', async () => {
  const net = stubFetch({ 'POST api/reviews/r-1/threads': { thread: { id: 't-1' }, fileSig: { path: 'src/a.ts', sig: 's-2' } } });
  const user = userEvent.setup();
  renderInReview(<HunkBar hunk={hunk()} path="src/a.ts" commentable />);
  await user.click(screen.getByRole('button', { name: 'Comment on hunk' }));
  await user.selectOptions(screen.getByLabelText('Kind'), 'question');
  await user.type(screen.getByLabelText('Message'), 'why');
  await user.click(screen.getByRole('button', { name: 'Post' }));
  await waitFor(() => expect(net.calls[0].body).toEqual({ anchor: { kind: 'hunk', hunkId: 'h1' }, kind: 'question', body: 'why' }));
});

// A harness whose patchVerdicts really updates the hunk, so the pressed state reflects what the UI shows.
function Stateful() {
  const [h, setH] = useState(hunk({ verdict: 'pending' }));
  const value = ctxValue({ diffs: { patchVerdicts: (_path: string, v: Record<string, never>) => setH((x) => ({ ...x, verdict: v.h1 })) } as never });
  return <ReviewProvider value={value}><HunkBar hunk={h} path="src/a.ts" commentable /></ReviewProvider>;
}

// Invariant: the bar flips at once (before the server answers) from undecided to the chosen verdict's chip.
test('the hunk bar flips before the server answers', async () => {
  stubFetch({ 'PUT api/reviews/r-1/hunks/h1/verdict': () => new Promise(() => {}) });
  render(<Stateful />);
  expect(screen.getByText('undecided')).toBeTruthy();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Accept' }));
  expect(screen.getByText('✓ Accepted')).toBeTruthy();
  expect(screen.queryByText('undecided')).toBeNull();
});

// Invariant: after a refusal the bar is back on the verdict it had.
test('after a refusal the bar is back to undecided', async () => {
  vi.spyOn(toast, 'error').mockImplementation(() => '');
  stubFetch({ 'PUT api/reviews/r-1/hunks/h1/verdict': refusal('REVIEW_CLOSED') });
  render(<Stateful />);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Accept' }));
  await waitFor(() => expect(screen.getByText('undecided')).toBeTruthy());
  expect(screen.queryByText('✓ Accepted')).toBeNull();
});

// Invariant: a null verdict reads as undecided, like pending.
test('a null verdict shows as undecided', () => {
  renderInReview(<HunkBar hunk={hunk({ verdict: null })} path="src/a.ts" commentable />);
  expect(screen.getByText('undecided')).toBeTruthy();
});

// Invariant: the decided chip carries its hue in the background only, with neutral text (a hued label misses AA contrast); no other verdict's hue.
test.each([['accepted', '✓ Accepted', 'success', 'destructive'], ['rejected', '✗ Rejected', 'destructive', 'success']] as const)('the %s chip is tinted %s in the background with neutral text', (verdict, text, hue, other) => {
  renderInReview(<HunkBar hunk={hunk({ verdict })} path="src/a.ts" commentable />);
  const { className } = screen.getByText(text);
  expect(className).toMatch(new RegExp(`\\bbg-${hue}/\\d+\\b`));
  expect(className).toMatch(/\btext-foreground\b/);
  expect(className).not.toMatch(new RegExp(`-${other}\\b`));
});

// Invariant: the group verdict control keeps its tint keyed on aria-pressed: own hue in the background only, neutral text, both hover shades (the dark one is required: ghost's dark hover out-specifies the plain background).
const HUES = { Accept: 'success', Reject: 'destructive', Pending: 'info' } as const;
test.each(Object.entries(HUES))('the group %s segment carries its own aria-pressed hue (%s) in the background, neutral text, both hover shades, and no other tint', (name, hue) => {
  render(<VerdictToggle label="Group verdict" value="pending" labels={['Accept', 'Reject', 'Pending']} onChange={() => {}} />);
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
  const { container } = renderInReview(<HunkBar hunk={hunk()} path="src/a.ts" commentable />, { round: 1, readOnly: true });
  expect(container.firstChild).toBeNull();
});
