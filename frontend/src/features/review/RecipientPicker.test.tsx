import { screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import type { Session } from '@/lib/types';
import { renderInReview } from '@/test/renderCtx';
import { RecipientPicker } from './RecipientPicker';

const session = (sessionId: string, label: string | null): Session =>
  ({ sessionId, project: 'app', worktree: null, label, status: 'idle', live: true, conductor: false, conducted: false, attached: false });

test('each live session is offered under its label, or its id when it has none', () => {
  renderInReview(<RecipientPicker onClose={vi.fn()} />, {
    sessions: [session('s-titled', 'Builder'), session('s-untitled', 'Fix the login bug'), session('s-bare', null)],
  });
  expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['No recipient', 'Builder', 'Fix the login bug', 's-bare']);
});

test('sessions that share a label are told apart by their id prefix; a unique label keeps no suffix', () => {
  renderInReview(<RecipientPicker onClose={vi.fn()} />, {
    sessions: [session('abcd1234-x', '(new session)'), session('efgh5678-y', '(new session)'), session('s-titled', 'Builder')],
  });
  expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['No recipient', '(new session) · abcd1234', '(new session) · efgh5678', 'Builder']);
});
