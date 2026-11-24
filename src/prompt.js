import { clean } from './text.js';

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export const MAX_LISTED_FILES = 20;
export const MAX_LISTED_HUNKS = 20;

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
 * {id, round, project, worktree, label, role, uncommitted, author, tally, groups:{accepted:[{id, title, hunks:n}], rejected:[{id, title, hunks:[{path, header, id}]}]},
 * rejected:[{path, header, id}], undecided:[{path, header, id}], note:{id, body}|null, threads:[{id, kind, where, note}], files:[path]|null}
 * `undecided` lists every hunk with no verdict; `note` is the human's overall note, carried unclipped.
 */
const noteBlock = (note) => ['', `Reviewer note [${note.id}] (reply on that thread):`, ...note.body.split('\n').map(clean)];
const hunkLine = (h) => `- ${clean(h.path)} ${clean(h.header)} (h:${h.id})`;

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
    if (p.note) out.push(...noteBlock(p.note));
  } else {
    out.push('', `Verdicts: ${p.tally.accepted} accepted, ${p.tally.rejected} rejected, ${p.tally.pending} not reviewed yet.`);
    if (p.note) out.push(...noteBlock(p.note));
    const { accepted, rejected: rejectedGroups } = p.groups;
    if (accepted.length) out.push('', 'Accepted groups:', ...accepted.map((g) => `- [${g.id}] ${clip(clean(g.title), 120)} (${g.hunks} hunk${g.hunks === 1 ? '' : 's'})`));
    if (rejectedGroups.length) {
      out.push('', 'Rejected groups:');
      for (const g of rejectedGroups) out.push(`- [${g.id}] ${clip(clean(g.title), 120)}`, ...g.hunks.map((h) => `  - ${clean(h.path)} ${clean(h.header)} (h:${h.id})`));
    }
    if (p.rejected.length) out.push('', 'Rejected hunks:', ...p.rejected.map(hunkLine));
    if (p.undecided.length) {
      out.push('', 'Not reviewed yet (no verdict from the human; do not treat these as accepted):', ...p.undecided.slice(0, MAX_LISTED_HUNKS).map(hunkLine));
      if (p.undecided.length > MAX_LISTED_HUNKS) out.push(`- … and ${p.undecided.length - MAX_LISTED_HUNKS} more`);
    }
  }
  if (p.threads.length) out.push('', 'Threads with new activity:', ...p.threads.map((t) => `[${t.id}] ${t.kind} · ${clean(t.where)}: ${clip(clean(t.note), 120)}`));
  out.push('', closing(p));
  return out.join('\n');
}

/**
 * Text sent to the recipient to have the round grouped (Guide me). Input from submissions.js:
 * {id, round, project, worktree, label, role, author, groups: n, dropped: n, newUngrouped: n, ungrouped: n|null}
 */
export function renderGuidePrompt(p) {
  const where = clean(p.worktree ? `${p.project}/${p.worktree}` : p.project);
  const out = [`Code review ${p.id} · round ${p.round} · ${where} · ${clean(p.label)} · you are the ${p.role}`, '', "Please group this round's diff into review steps."];
  if (!p.groups) out.push('It has no groups yet.');
  else {
    const parts = [`${p.groups} group${p.groups === 1 ? '' : 's'}`];
    if (p.dropped) parts.push(`${p.dropped} dropped by a refresh`);
    if (p.newUngrouped) parts.push(`${p.newUngrouped} new hunk${p.newUngrouped === 1 ? '' : 's'} in no group`);
    if (p.ungrouped) parts.push(`${p.ungrouped} hunk${p.ungrouped === 1 ? '' : 's'} in no group`);
    out.push(`${parts.join('; ')}.`);
  }
  if (p.role === 'conductor') out.push('', `Relay this to ${p.author ? `the author (session ${clean(p.author)})` : 'the author'}: tell it to group review=${p.id} with propose_groups.`);
  else out.push('', `Use the code-review tools with review=${p.id}: read get_review and get_hunk, then call propose_groups with every group of the round, in reading order.`);
  return out.join('\n');
}
