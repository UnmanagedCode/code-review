import type { Author, DiffFile, DiffLine, FileState, InboxItem, LinesAnchor, Message, ReviewSummary, TextHunk, Thread } from '@/lib/types';

export const HUMAN: Author = { kind: 'human' };
export const agent = (sessionId = 's-rev', role: 'author' | 'reviewer' | 'conductor' = 'reviewer'): Author => ({ kind: 'session', sessionId, role });

export const review = (over: Partial<ReviewSummary> = {}): ReviewSummary => ({
  id: 'r-1', project: 'app', worktree: 'feature', branch: 'feature', kind: 'range', target: {}, label: 'main…feature', title: null,
  status: 'open', recipient: 's-author', author: null, recipientRole: 'author', round: 1, headSha: 'a'.repeat(40), baseSha: 'b'.repeat(40),
  headMoved: false, dirty: false, checkoutGone: false,
  counts: { files: 1, hunks: { pending: 1, accepted: 0, rejected: 0 }, threads: { open: 0, resolved: 0, outdated: 0 } },
  mergeBlockers: 0, unread: 0, seenByHuman: true, rev: 1, createdAt: '2026-01-01T00:00:00Z', createdBy: HUMAN, lastSubmission: null,
  ...over,
});

export const fileState = (over: Partial<FileState> = {}): FileState => ({
  path: 'src/a.ts', oldPath: null, status: 'modified', binary: false, tooLarge: false, additions: 2, deletions: 1, hunks: 1,
  verdicts: { pending: 1, accepted: 0, rejected: 0 }, threads: { open: 0, resolved: 0, outdated: 0 }, unread: 0, sig: 's-1', ...over,
});

export const lines = (spec: string): DiffLine[] => {
  // "c3 d4 a4" style: type letter + number; ctx/add use the number as new, ctx/del as old.
  const out: DiffLine[] = [];
  let o = 0, n = 0;
  for (const tok of spec.split(' ')) {
    const t = tok[0] === 'c' ? 'ctx' : tok[0] === 'a' ? 'add' : 'del';
    if (t !== 'add') o++;
    if (t !== 'del') n++;
    out.push({ t, old: t === 'add' ? null : o, new: t === 'del' ? null : n, text: `${tok}` });
  }
  return out;
};

export const hunk = (over: Partial<TextHunk> = {}): TextHunk => ({
  id: 'h1', kind: 'text', header: '@@ -1,4 +1,4 @@', oldStart: 1, oldLines: 4, newStart: 1, newLines: 4,
  lines: lines('c1 c2 d3 a3 c4'), verdict: 'pending', ...over,
});

export const diffFile = (over: Partial<DiffFile> = {}): DiffFile => {
  const { hunks: _h, threads: _t, ...rest } = fileState();
  return { ...rest, hunks: [hunk()], threads: [], lineCount: { old: 4, new: 4 }, ...over };
};

export const message = (over: Partial<Message> = {}): Message => ({ id: 1, author: HUMAN, body: 'hello', at: '2026-01-01T00:00:00Z', round: 1, citations: [], ...over });

export const linesAnchor = (over: Partial<LinesAnchor> = {}): LinesAnchor => ({
  kind: 'lines', file: 'src/a.ts', side: 'new', startLine: 3, endLine: 3, hunkId: 'h1', round: 1, drifted: false, ...over,
});

export const thread = (over: Partial<Thread> = {}): Thread => ({
  id: 't-1', kind: 'comment', severity: null, status: 'open', disposition: null, resolveProposed: false,
  anchor: linesAnchor(),
  openedBy: HUMAN, unread: 0, messages: [message()], ...over,
});

export const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });
export const refusal = (code: string, status = 409, reason = 'because'): Response => json({ ok: false, code, reason }, status);

export const inboxItem = (over: Partial<InboxItem> = {}): InboxItem => ({
  id: 'r-1', project: 'app', worktree: 'feature', branch: 'feature', kind: 'range', label: 'main…feature', title: '', round: 1,
  unread: 0, seenByHuman: true, lastActivityAt: '2026-01-01T00:00:00Z', turn: 'human', checkoutGone: false,
  ...over,
});
