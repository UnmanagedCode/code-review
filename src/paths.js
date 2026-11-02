import path from 'node:path';
import { Refusal } from './refusals.js';

/** The data dir cc assigns this plugin (CONDUCTOR_PLUGIN_DATA_DIR); read on every call. It may not exist yet: writers create it. */
export function storeRoot(env = process.env) {
  const dir = env.CONDUCTOR_PLUGIN_DATA_DIR;
  if (dir && path.isAbsolute(dir)) return dir;
  throw new Refusal('STORE_UNCONFIGURED', 'CONDUCTOR_PLUGIN_DATA_DIR must be an absolute path (cc sets it for the backends it starts)');
}
