import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { resetCodeGit } from '@/lib/codeGit';
import { resetSse } from '@/lib/sse';
import { resetDiffPrefs } from '@/state/diffPrefs';
import { resetDrafts } from '@/state/drafts';
import { resetDropped } from '@/state/dropped';
import { resetMarks } from '@/state/readMarks';
import { resetTop } from './fakeTop';
import { resetResources } from '@/state/resource';

afterEach(() => {
  cleanup();
  resetDropped();
  resetMarks();
  resetResources();
  resetSse();
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
