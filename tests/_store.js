import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Points CONDUCTOR_PLUGIN_DATA_DIR at a fresh temp dir; returns {dir, cleanup}. */
export function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-store-'));
  const prev = process.env.CONDUCTOR_PLUGIN_DATA_DIR;
  process.env.CONDUCTOR_PLUGIN_DATA_DIR = dir;
  return {
    dir,
    cleanup() {
      if (prev === undefined) delete process.env.CONDUCTOR_PLUGIN_DATA_DIR; else process.env.CONDUCTOR_PLUGIN_DATA_DIR = prev;
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
