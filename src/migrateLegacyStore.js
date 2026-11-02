// The only code that names <PROJECTS_ROOT>/.code-review. Delete this file and its main() call in server.js once no
// install keeps a legacy store. Not src/migrate.js, which upgrades the shape of stored reviews.
//
// A refusal never moves or changes store data. It may leave behind an emptied target that is now removed, or empty
// parent dirs it created; both are harmless, and a re-run after the fix succeeds.
import fs from 'node:fs';
import path from 'node:path';
import { storeRoot } from './paths.js';
import { Refusal } from './refusals.js';

export const LEGACY_DIRNAME = '.code-review';

/**
 * Moves the legacy store into the data dir with one rename.
 * @param {{ env: Record<string,string|undefined>, rename?: (from: string, to: string) => void }} opts
 *   env: required, with no default, so a caller (a test) must name the PROJECTS_ROOT it means.
 *   rename: seam for the cross-device branch; defaults to fs.renameSync.
 * @returns {'unconfigured'|'absent'|'moved'}
 */
export function migrateLegacyStore({ env, rename = fs.renameSync }) {
  if (!env.PROJECTS_ROOT) return 'unconfigured';
  let target;
  try {
    target = storeRoot(env);
  } catch (e) {
    if (e instanceof Refusal && e.code === 'STORE_UNCONFIGURED') return 'unconfigured';
    throw e;
  }
  const legacy = path.join(path.resolve(env.PROJECTS_ROOT), LEGACY_DIRNAME);
  const refuse = (detail, cause) => new Error(`code-review: cannot move the store ${legacy} to ${target}: ${detail}`, { cause });
  const other = (e) => refuse(`${e.message}; fix the cause, then restart code-review`, e);

  let st;
  try {
    st = fs.lstatSync(legacy);
  } catch (e) {
    if (e.code === 'ENOENT') return 'absent';
    throw refuse(`cannot inspect ${legacy}: ${e.message}; fix its permissions, then restart code-review`, e);
  }
  if (!st.isDirectory()) throw refuse(`${legacy} is not a directory; move or remove it, then restart code-review`);

  const notEmpty = () => refuse(`${target} is not empty, so nothing was moved. Keep one: delete ${legacy} to use ${target} as is, or delete ${target} to move ${legacy} on the next start`);
  let tst = null;
  try {
    tst = fs.lstatSync(target);
  } catch (e) {
    if (e.code !== 'ENOENT') throw other(e);
  }
  if (tst) {
    if (!tst.isDirectory()) throw refuse(`${target} is not a directory; move or remove it, then restart code-review`);
    let entries;
    try {
      entries = fs.readdirSync(target);
    } catch (e) {
      throw other(e);
    }
    if (entries.length > 0) throw notEmpty();
    try {
      fs.rmdirSync(target);
    } catch (e) {
      throw e.code === 'ENOTEMPTY' ? notEmpty() : other(e);
    }
  }

  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
  } catch (e) {
    throw other(e);
  }
  try {
    rename(legacy, target);
  } catch (e) {
    if (e.code === 'EXDEV') {
      throw refuse(`they are on different filesystems, so nothing was moved. With code-review stopped, run \`mv '${legacy}' '${target}'\` (keeps modes), then restart code-review`, e);
    }
    throw other(e);
  }
  console.log(`code-review: moved the store from ${legacy} to ${target}`);
  return 'moved';
}
