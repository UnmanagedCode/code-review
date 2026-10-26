import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { resetCodeGit } from '@/lib/codeGit';
import { resetDiffPrefs } from '@/state/diffPrefs';
import { resetDrafts } from '@/state/drafts';
import { resetDropped } from '@/state/dropped';
import { resetMarks } from '@/state/readMarks';
import { resetTop } from './fakeTop';

afterEach(() => {
  cleanup();
  resetDropped();
  resetMarks();
  resetDrafts();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete window.ccBridge;
  localStorage.clear();
  resetDiffPrefs();
  resetCodeGit();
  resetTop();
  history.replaceState(null, '', '?');
});
