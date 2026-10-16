import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, vi } from 'vitest';
import { thread } from '@/test/fixtures';
import { renderInReview } from '@/test/renderCtx';
import { stubFetch } from '@/test/stubFetch';
import { Composer, MAX_BODY_CHARS } from './Composer';

const anchor = { file: 'src/a.ts', side: 'new' as const, startLine: 3, endLine: 4 };
const posted = (net: ReturnType<typeof stubFetch>) => net.calls.find((c) => c.method === 'POST')?.body;
const post = () => screen.getByRole('button', { name: 'Post' }) as HTMLButtonElement;

test('posts the exact anchor and kind', async () => {
  const net = stubFetch({ 'POST api/reviews/r-1/threads': { thread: thread() } });
  const onClose = vi.fn();
  const user = userEvent.setup();
  renderInReview(<Composer anchor={anchor} label="L3–L4 (new)" onClose={onClose} />);
  await user.selectOptions(screen.getByLabelText('Kind'), 'question');
  await user.type(screen.getByLabelText('Message'), 'why?');
  await user.click(post());
  await waitFor(() => expect(posted(net)).toEqual({ anchor, kind: 'question', body: 'why?' }));
  expect(onClose).toHaveBeenCalled();
});

test('a finding needs a severity before Post enables, and sends it', async () => {
  const net = stubFetch({ 'POST api/reviews/r-1/threads': { thread: thread() } });
  const user = userEvent.setup();
  renderInReview(<Composer anchor={anchor} label="x" onClose={() => {}} />);
  await user.selectOptions(screen.getByLabelText('Kind'), 'finding');
  await user.type(screen.getByLabelText('Message'), 'bug');
  expect(post().disabled).toBe(true);
  await user.selectOptions(screen.getByLabelText('Severity'), 'major');
  expect(post().disabled).toBe(false);
  await user.click(post());
  await waitFor(() => expect(posted(net)).toMatchObject({ kind: 'finding', severity: 'major' }));
});

test('a body over the limit disables Post and shows the counter', async () => {
  renderInReview(<Composer anchor={anchor} label="x" onClose={() => {}} />);
  const box = screen.getByLabelText('Message');
  await userEvent.setup().click(box);
  await userEvent.setup().paste('x'.repeat(MAX_BODY_CHARS + 1));
  expect(screen.getByText(`${MAX_BODY_CHARS + 1} / ${MAX_BODY_CHARS}`)).toBeTruthy();
  expect(post().disabled).toBe(true);
});

test('a hunk anchor is posted as {hunkId}', async () => {
  const net = stubFetch({ 'POST api/reviews/r-1/threads': { thread: thread() } });
  const user = userEvent.setup();
  renderInReview(<Composer anchor={{ hunkId: 'h1' }} label="hunk" onClose={() => {}} />);
  await user.type(screen.getByLabelText('Message'), 'whole hunk');
  await user.click(post());
  await waitFor(() => expect(posted(net)).toEqual({ anchor: { hunkId: 'h1' }, kind: 'comment', body: 'whole hunk' }));
});

test('the body limit equals the backend’s MAX_BODY_CHARS', () => {
  const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'src', 'threads.js'), 'utf8');
  expect(MAX_BODY_CHARS).toBe(Number(/MAX_BODY_CHARS\s*=\s*([\d_]+)/.exec(src)![1].replace(/_/g, '')));
});
