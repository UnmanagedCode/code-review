import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { resetDrafts } from '@/state/drafts';
import { resetDropped } from '@/state/dropped';
import { resetMarked } from '@/state/threads';

afterEach(() => {
  cleanup();
  resetDropped();
  resetMarked();
  resetDrafts();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete window.ccBridge;
  localStorage.clear();
  history.replaceState(null, '', '?');
});
