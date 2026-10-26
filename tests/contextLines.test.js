import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DIFF_FLAGS } from '../src/git.js';
import { GIT_CONTEXT_LINES } from '../frontend/src/lib/gitContext.ts';

test('git is asked for exactly the context lines the UI assumes', () => {
  // Invariant: the Diff options' trim and baseline math (frontend/src/lib/contextLines.ts) count from GIT_CONTEXT_LINES,
  // so DIFF_FLAGS must carry that -U and no other.
  assert.deepEqual(DIFF_FLAGS.filter((f) => /^-U/.test(f)), [`-U${GIT_CONTEXT_LINES}`]);
});
