import { clean } from './text.js';
import { anchorLabel } from './anchor.js';

// Plain-text renderings for MCP results: agents read these, so they stay compact.
// Header fields go through clean(); code lines and message bodies stay verbatim.
const fence = (lines) => ['```', ...lines, '```'];
const sid8 = (a) => clean(a.sessionId.slice(0, 8));
export const who = (a) => (a.kind === 'human' ? 'human' : `${a.role} ${sid8(a)}`);


/** Per-file rollup of a ReviewSummary + FileStates, with a line for the review threads when there are any. */
export function renderRollup(s, files, reviewThreads = []) {
  const out = [
    `${clean(s.id)} · ${clean(s.label)} · round ${s.round} · ${s.status}`,
    `recipient: ${s.recipient ? `${clean(s.recipient)} (${s.recipientRole})` : 'none'}${s.author ? ` · author: ${clean(s.author)}` : ''} · mergeBlockers: ${s.mergeBlockers} · unread: ${s.unread}`,
    `threads: ${s.counts.threads.open} open, ${s.counts.threads.resolved} resolved, ${s.counts.threads.outdated} outdated`,
  ];
  if (reviewThreads.length) {
    const open = reviewThreads.filter((t) => t.status === 'open').length;
    out.push(`review threads: ${open} open/${reviewThreads.length - open} resolved`);
  }
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
    const out = [`[${t.id}] ${t.kind}${t.severity ? `/${t.severity}` : ''} · ${t.status} · ${where} · by ${who(t.openedBy)}${a.drifted ? ' · drifted' : ''}${t.resolveProposed ? ' · resolution proposed' : ''}${t.disposition ? ` · ${t.disposition}` : ''}`];
    if (t.anchorLines) out.push(...fence(t.anchorLines.map((l, i) => `${String(a.startLine + i).padStart(4)}  ${l}`)));
    for (const m of t.messages) {
      out.push(`— ${who(m.author)}:`, m.body);
      for (const e of m.excerpts) {
        if (e.error) { out.push(`(unresolved: ${clean(e.error)})`); continue; }
        out.push(`${clean(e.path)}#L${e.startLine}${e.endLine > e.startLine ? `-L${e.endLine}` : ''} @${clean(m.ref)}`);
        out.push(...fence([...e.lines.map((l) => `${String(l.n).padStart(4)}  ${l.text}`), ...(e.truncated ? ['… (truncated)'] : [])]));
      }
    }
    return out.join('\n');
  });
  return blocks.join('\n\n');
}

/** One hunk with `old new` line-number gutters. */
export function renderHunk(path, entry) {
  const { hunk, verdict, threadIds } = entry;
  const head = `${clean(path)} ${hunk.kind === 'text' ? clean(hunk.header) : '(file-level change)'} (h:${hunk.id})${verdict ? ` · ${verdict}` : ''}${threadIds.length ? ` · threads ${threadIds.join(', ')}` : ''}`;
  const num = (n) => (n === null ? '    ' : String(n).padStart(4));
  const sign = { ctx: ' ', add: '+', del: '-' };
  return [head, ...hunk.lines.map((l) => `${num(l.old)} ${num(l.new)} ${sign[l.t]}${l.text}`)].join('\n');
}
