import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { vi } from 'vitest';
import type { FileDiffState } from '@/state/fileDiff';
import { ReviewProvider, type ReviewCtx } from '@/state/reviewContext';
import { diffFile, fileState, review } from './fixtures';

export function ctxValue(over: Partial<ReviewCtx> = {}): ReviewCtx {
  const fileDiff = { file: diffFile(), rows: [], side: 'new', total: null, expand: vi.fn(), reveal: vi.fn(), patchThread: vi.fn(), patchVerdict: vi.fn(), reload: vi.fn(), loading: false, error: undefined, ...(over.fileDiff ?? {}) } as unknown as FileDiffState;
  return {
    id: 'r-1', review: review(), files: [fileState()], rounds: [{ n: 1, headSha: 'a', baseSha: 'b', createdAt: '', submittedAt: null }], submissions: [], outdatedThreads: [],
    commit: undefined, readOnly: false, sessions: [], reload: vi.fn(), applyReview: vi.fn(), ...over, fileDiff,
  };
}

/** Renders `ui` inside a ReviewProvider; returns the context value so tests can assert on its spies. */
export function renderInReview(ui: ReactElement, over: Partial<ReviewCtx> = {}) {
  const value = ctxValue(over);
  return { value, ...render(<ReviewProvider value={value}>{ui}</ReviewProvider>) };
}
