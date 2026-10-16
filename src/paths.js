import path from 'node:path';
import { Refusal } from './refusals.js';

/** Root dir of the review store; resolved on every call so tests and late env changes apply. */
export function storeRoot() {
  if (process.env.CODE_REVIEW_STORE) return process.env.CODE_REVIEW_STORE;
  if (process.env.PROJECTS_ROOT) return path.join(process.env.PROJECTS_ROOT, '.code-review');
  throw new Refusal('STORE_UNCONFIGURED', 'set CODE_REVIEW_STORE or PROJECTS_ROOT');
}
