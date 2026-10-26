import * as cc from './cc.js';

/** The plugin id of code-git; the only place it is named. */
export const CODE_GIT_PLUGIN = 'code-git';

/** `{id}` when cc has code-git enabled with a view to open, else null. A cc that cannot answer refuses. */
export async function codeGitPlugin() {
  const { rows } = await cc.plugins();
  const row = rows.find((p) => p.id === CODE_GIT_PLUGIN && p.enabled && p.hasFrontend);
  return row ? { id: row.id } : null;
}
