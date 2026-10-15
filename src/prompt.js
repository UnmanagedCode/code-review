const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export const MAX_LISTED_FILES = 20;

/**
 * Text sent to the recipient session. Input is prepared by submissions.js:
 * {id, round, project, worktree, label, role, tally, rejected:[{path, header, id}], threads:[{id, kind, where, note}], files:[path]|null}
 */
export function renderPrompt(p) {
  const where = p.worktree ? `${p.project}/${p.worktree}` : p.project;
  const out = [`Code review ${p.id} · round ${p.round} · ${where} · ${p.label} · you are the ${p.role}`];
  if (p.role === 'reviewer') {
    out.push('', 'Please review the uncommitted changes in this checkout.');
    if (p.files) {
      out.push(`${p.files.length} changed file${p.files.length === 1 ? '' : 's'}:`);
      out.push(...p.files.slice(0, MAX_LISTED_FILES).map((f) => `- ${f}`));
      if (p.files.length > MAX_LISTED_FILES) out.push(`- … and ${p.files.length - MAX_LISTED_FILES} more`);
    }
  } else {
    out.push('', `Verdicts: ${p.tally.accepted} accepted, ${p.tally.rejected} rejected, ${p.tally.pending} pending.`);
    if (p.rejected.length) out.push('', 'Rejected hunks:', ...p.rejected.map((h) => `- ${h.path} ${h.header} (h:${h.id})`));
  }
  if (p.threads.length) out.push('', 'Threads with new activity:', ...p.threads.map((t) => `[${t.id}] ${t.kind} · ${t.where}: ${clip(t.note, 120)}`));
  out.push('', p.role === 'reviewer'
    ? `Use the code-review tools with review=${p.id}: annotate findings, list_threads and reply.`
    : `Use the code-review tools with review=${p.id}: list_threads, then reply on each thread; fix rejected hunks, commit, refresh_review.`);
  return out.join('\n');
}
