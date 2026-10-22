import fs from 'node:fs';
import path from 'node:path';
import { storeRoot } from './paths.js';

export const LOG_MAX_BYTES = 1024 * 1024;

/** The operator log: one JSON object per line, rotated to `cc.log.1` past LOG_MAX_BYTES. */
export const logPath = () => path.join(storeRoot(), 'logs', 'cc.log');

/** Appends `entry` to the operator log and to stderr. A failure to write is reported on stderr and never thrown. */
export function logEvent(entry) {
  const line = JSON.stringify(entry);
  try {
    const file = logPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file) && fs.statSync(file).size > LOG_MAX_BYTES) fs.renameSync(file, `${file}.1`);
    fs.appendFileSync(file, `${line}\n`);
  } catch (e) {
    console.error(`code-review: could not write the operator log: ${e.message}`);
  }
  console.error(`code-review: ${line}`);
}
