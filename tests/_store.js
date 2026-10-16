import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Points CODE_REVIEW_STORE at a fresh temp dir; returns {dir, cleanup}. */
export function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-store-'));
  const prev = process.env.CODE_REVIEW_STORE;
  process.env.CODE_REVIEW_STORE = dir;
  return {
    dir,
    cleanup() {
      if (prev === undefined) delete process.env.CODE_REVIEW_STORE; else process.env.CODE_REVIEW_STORE = prev;
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
