import { clean } from './text.js';

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export const MAX_LISTED_FILES = 20;

function closing(p) {
  if (p.role === 'reviewer') return `Use the code-review tools with review=${p.id}: annotate findings, list_threads and reply.`;
  if (p.role === 'author') return `Use the code-review tools with review=${p.id}: list_threads, then reply on each thread; fix rejected hunks, commit, refresh_review.`;
  if (p.uncommitted) return `Brief a reviewer to post its findings with the code-review tools, review=${p.id}.`;
  const to = p.author ? `the author (session ${clean(p.author)})` : 'the author';
  return `Relay this round to ${to}: tell it to work review=${p.id} as its author with the code-review tools.`;
}

/**
 * Text sent to the recipient session. The body follows the review kind (`uncommitted`), the closing line the role;
 * `author` is the review's stored author session or null. Input is prepared by submissions.js:
 * {id, round, project, worktree, label, role, uncommitted, author, tally, rejected:[{path, header, id}], threads:[{id, kind, where, note}], files:[path]|null}
 */
export function renderPrompt(p) {
  const where = clean(p.worktree ? `${p.project}/${p.worktree}` : p.project);
  const out = [`Code review ${p.id} · round ${p.round} · ${where} · ${clean(p.label)} · you are the ${p.role}`];
  if (p.uncommitted) {
    out.push('', 'Please review the uncommitted changes in this checkout.');
    if (p.files) {
      out.push(`${p.files.length} changed file${p.files.length === 1 ? '' : 's'}:`);
      out.push(...p.files.slice(0, MAX_LISTED_FILES).map((f) => `- ${clean(f)}`));
      if (p.files.length > MAX_LISTED_FILES) out.push(`- … and ${p.files.length - MAX_LISTED_FILES} more`);
    }
  } else {
    out.push('', `Verdicts: ${p.tally.accepted} accepted, ${p.tally.rejected} rejected, ${p.tally.pending} pending.`);
    if (p.rejected.length) out.push('', 'Rejected hunks:', ...p.rejected.map((h) => `- ${clean(h.path)} ${clean(h.header)} (h:${h.id})`));
  }
  if (p.threads.length) out.push('', 'Threads with new activity:', ...p.threads.map((t) => `[${t.id}] ${t.kind} · ${clean(t.where)}: ${clip(clean(t.note), 120)}`));
  out.push('', closing(p));
  return out.join('\n');
}
