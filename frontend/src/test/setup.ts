import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { resetDropped } from '@/state/dropped';

afterEach(() => {
  cleanup();
  resetDropped();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete window.ccBridge;
  localStorage.clear();
  history.replaceState(null, '', '?');
});
