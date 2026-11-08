import { clean } from './text.js';
import { anchorLabel } from './anchor.js';

// Plain-text renderings for MCP results: agents read these, so they stay compact.
// Header fields go through clean(); code lines and message bodies stay verbatim.
const fence = (lines) => ['```', ...lines, '```'];
const sid8 = (a) => clean(a.sessionId.slice(0, 8));
export const who = (a) => (a.kind === 'human' ? 'human' : `${a.role} ${sid8(a)}`);


/** Text views cut a cited excerpt at this many lines; the json view never cuts. */
export const MAX_EXCERPT_LINES = 80;

const hunkIds = (ids) => ids.map((h) => `h:${h}`).join(' ');

// One group: `<order>. [<id>] <verdict> · <title> · h:<id> …`. Shared by the rollup and the proposal ack.
const groupLine = (g) => `${g.order}. [${g.id}] ${g.verdict} · ${clean(g.title)} · ${hunkIds(g.hunkIds)}`;

// The guide block of the rollup: a header, one line per group, then the ungrouped hunks by file.
function renderGuide(guide) {
  const n = (v) => guide.groups.filter((g) => g.verdict === v).length;
  const out = [`groups: ${guide.groups.length} (${n('accepted')} accepted, ${n('rejected')} rejected, ${n('pending')} pending) · ungrouped hunks: ${guide.ungrouped ? guide.ungrouped.length : 'unknown'} · guide me: ${guide.guideMe.offered ? 'offered' : 'no'}`];
  for (const g of guide.groups) out.push(groupLine({ ...g, hunkIds: g.hunks.map((h) => h.id) }));
  if (guide.ungrouped?.length) {
    const byFile = new Map();
    for (const h of guide.ungrouped) byFile.set(h.file, [...(byFile.get(h.file) ?? []), h.id]);
    out.push(`ungrouped: ${[...byFile].map(([file, ids]) => `${clean(file)} ${hunkIds(ids)}`).join('; ')}`);
  }
  return out;
}

/** The three header lines of a ReviewSummary: identity and state, recipient and blockers, thread counts. */
export const summaryLines = (s) => [
  `${clean(s.id)} · ${clean(s.label)} · round ${s.round} · ${s.status}`,
  `recipient: ${s.recipient ? `${clean(s.recipient)} (${s.recipientRole})` : 'none'}${s.author ? ` · author: ${clean(s.author)}` : ''} · mergeBlockers: ${s.mergeBlockers} · unread: ${s.unread}`,
  `threads: ${s.counts.threads.open} open, ${s.counts.threads.resolved} resolved, ${s.counts.threads.outdated} outdated`,
];

/** Ack of `open_review`: new or reused, the summary header and the review's link. */
export const renderOpened = (review, reused) => [
  reused ? `reused the open review ${clean(review.id)}` : `opened review ${clean(review.id)}`,
  ...summaryLines(review),
  `link: ${review.link}`,
].join('\n');

/** Per-file rollup of a ReviewSummary (with its `link`) + FileStates, with a line for the review threads when there are any, and the groups when `guide` is set. */
export function renderRollup(s, files, reviewThreads = [], guide = null) {
  const out = [...summaryLines(s), `link: ${s.link}`];
  if (reviewThreads.length) {
    const open = reviewThreads.filter((t) => t.status === 'open').length;
    out.push(`review threads: ${open} open/${reviewThreads.length - open} resolved`);
  }
  if (guide) out.push(...renderGuide(guide));
  if (s.snapshotError) out.push(`diff unavailable: ${clean(s.snapshotError)}`);
  for (const f of files) {
    const v = f.verdicts ? `hunks ${f.verdicts.pending} pending/${f.verdicts.accepted} accepted/${f.verdicts.rejected} rejected` : `hunks ${f.hunks}`;
    out.push(`${clean(f.path)}  ${f.status}  +${f.additions} -${f.deletions}  ${v}  threads ${f.threads.open} open/${f.threads.resolved} resolved/${f.threads.outdated} outdated`);
  }
  return out.join('\n');
}

/** Thread list from `listThreads`: header, anchored lines, messages, cited excerpts. */
export function renderThreads(threads) {
  const blocks = threads.map((t) => {
    const a = t.anchor;
    const where = a.kind === 'lines' ? `${clean(anchorLabel(a))} (${a.side})${a.hunkId ? ` · hunk h:${a.hunkId}` : ''}` : clean(anchorLabel(a));
    const out = [`[${t.id}] ${t.kind}${t.severity ? `/${t.severity}` : ''} · ${t.status} · ${where} · by ${who(t.openedBy)}${a.drifted ? ' · drifted' : ''}${t.resolveProposed ? ' · resolution proposed' : ''}${t.disposition ? ` · ${t.disposition}` : ''}`, `link: ${t.link}`];
    if (t.anchorLines) out.push(...fence(t.anchorLines.map((l, i) => `${String(a.startLine + i).padStart(4)}  ${l}`)));
    for (const m of t.messages) {
      out.push(`— ${who(m.author)}:`, m.body);
      for (const e of m.excerpts) {
        if (e.error) { out.push(`(unresolved: ${clean(e.error)})`); continue; }
        out.push(`${clean(e.path)}#L${e.startLine}${e.endLine > e.startLine ? `-L${e.endLine}` : ''} @${clean(m.ref)}`);
        const shown = e.lines.slice(0, MAX_EXCERPT_LINES);
        const hidden = e.lines.length - shown.length;
        const rest = hidden ? [`… ${hidden} more lines (L${e.lines[shown.length].n}-L${e.endLine}) not shown: read ${clean(e.path)} lines ${e.lines[shown.length].n}-${e.endLine} at ${clean(m.ref)}`] : [];
        out.push(...fence([...shown.map((l) => `${String(l.n).padStart(4)}  ${l.text}`), ...rest]));
      }
    }
    return out.join('\n');
  });
  return blocks.join('\n\n');
}

/** One hunk with `old new` line-number gutters. */
export function renderHunk(path, entry, { binary = false, tooLarge = false } = {}) {
  const { hunk, verdict, threadIds, groups } = entry;
  const head = `${clean(path)} ${hunk.kind === 'text' ? clean(hunk.header) : binary ? '(binary file: no lines)' : tooLarge ? '(too large to diff: no lines)' : '(file-level change)'} (h:${hunk.id})${verdict ? ` · ${verdict}` : ''}${threadIds.length ? ` · threads ${threadIds.join(', ')}` : ''}${groups.length ? ` · groups ${groups.join(', ')}` : ''}`;
  const num = (n) => (n === null ? '    ' : String(n).padStart(4));
  const sign = { ctx: ' ', add: '+', del: '-' };
  return [head, ...hunk.lines.map((l) => `${num(l.old)} ${num(l.new)} ${sign[l.t]}${l.text}`)].join('\n');
}

/** Ack of `annotate` (`verb` 'started') or `reply` (`verb` 'replied on') for the thread as it now stands. */
export function renderThreadWrite(verb, t) {
  if (verb === 'started') return `started thread ${t.id} · ${t.kind}${t.severity ? `/${t.severity}` : ''} · ${t.status} · on ${clean(anchorLabel(t.anchor))}`;
  const state = t.status === 'resolved' ? `resolved${t.disposition ? ` (${t.disposition})` : ''}` : t.resolveProposed ? 'resolution proposed to the human' : t.status;
  return `${verb} thread ${t.id} (${t.messages.at(-1).id}) · ${state}`;
}

/** Ack of `propose_groups`: the counts, the stored groups in order and the hunks in none. */
export function renderProposal(res) {
  return [
    `proposed ${res.groups.length} groups (kept ${res.kept}, retired ${res.retired}; ${res.threadsOutdated} group threads outdated)`,
    ...res.groups.map(groupLine),
    res.ungrouped.length ? `ungrouped: ${hunkIds(res.ungrouped)}` : 'ungrouped: none',
  ].join('\n');
}

/** Ack of `refresh_review`. */
export function renderRefresh(res) {
  if (res.unchanged) return `round ${res.round} unchanged: nothing new to snapshot`;
  const { hunks: h, threads: t, groups: g } = res;
  return `round ${res.round}: hunks ${h.kept} kept, ${h.reset} reset to pending, ${h.new} new · threads ${t.moved} moved, ${t.drifted} drifted, ${t.outdated} outdated, ${t.dropped} dropped · groups ${g.kept} kept, ${g.dropped} dropped`;
}
