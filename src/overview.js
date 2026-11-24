import { anchorView } from './anchor.js';
import { unreadOf } from './rollup.js';
import { threadState } from './threadState.js';

/** Longest preview of a message the overview shows. */
export const PREVIEW_CHARS = 140;
/** Most agent events the "since you last looked" feed carries. */
export const ACTIVITY_LIMIT = 50;

const previewOf = (body) => {
  const line = body.split('\n').find((l) => l.trim()) ?? '';
  const text = line.trim();
  return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS - 1)}…` : text;
};

const end = (m) => ({ author: m.author, at: m.at, preview: previewOf(m.body) });

/** ThreadDigest: one open thread, light enough to list across every file. */
export const threadDigest = (review, t) => ({
  id: t.id, kind: t.kind, severity: t.severity, status: t.status, state: threadState(review, t), anchor: anchorView(t.anchor),
  openedBy: t.openedBy, unread: unreadOf(t), resolveProposed: t.resolveProposed, messages: t.messages.length,
  first: end(t.messages[0]),
  last: { ...end(t.messages[t.messages.length - 1]), proposeResolve: t.messages[t.messages.length - 1].proposeResolve },
});

const num = (t) => Number(t.id.slice(1));

/** Every open thread of any anchor, in thread-number order. */
export const openThreadDigests = (review) => review.threads.filter((t) => t.status === 'open').sort((a, b) => num(a) - num(b)).map((t) => threadDigest(review, t));

/** The newest agent thread events, newest first. Group proposals and agent refreshes store no seq, so they are not listed. */
export function agentActivity(review) {
  const items = [];
  for (const t of review.threads) {
    t.messages.forEach((m, i) => {
      if (m.author.kind === 'human') return;
      let event = 'replied';
      if (i === 0) event = 'opened';
      else if (t.resolution && m.seq === t.resolution.seq && t.resolution.by.kind !== 'human') event = 'resolved';
      else if (m.proposeResolve) event = 'proposed-resolution';
      items.push({ seq: m.seq, at: m.at, actor: m.author, event, thread: { id: t.id, kind: t.kind, severity: t.severity, anchor: anchorView(t.anchor) } });
    });
  }
  return items.sort((a, b) => b.seq - a.seq).slice(0, ACTIVITY_LIMIT);
}
