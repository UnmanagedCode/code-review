// Wire shapes from docs/protocol.md → Shapes.
export type Kind = 'range' | 'commit' | 'uncommitted';
export type ThreadKind = 'comment' | 'question' | 'suggestion' | 'finding';
export type Severity = 'blocker' | 'major' | 'minor' | 'nit';
export type Verdict = 'pending' | 'accepted' | 'rejected';
export type Side = 'old' | 'new';
export type Role = 'author' | 'reviewer' | 'conductor';

export type Author = { kind: 'human' } | { kind: 'session'; sessionId: string; role: Role };

export interface Citation { raw: string; path: string; startLine: number; endLine: number }
export interface Message { id: number | string; author: Author; body: string; at: string; round: number; proposeResolve?: boolean; citations: Citation[] }

export interface Anchor {
  file: string; side: Side; startLine: number; endLine: number;
  hunkId: string | null; round: number; linesHash?: string; drifted: boolean;
}
export interface Thread {
  id: string; kind: ThreadKind; severity: Severity | null; status: 'open' | 'resolved' | 'outdated';
  disposition: 'fixed' | 'dismissed' | null; resolveProposed: boolean; anchor: Anchor;
  openedBy: Author; unread: number; messages: Message[];
  /** Round views only: messages written after that round (not shown). */
  laterMessages?: number;
}

/** A thread's copy in a round comparison: `from` = as of round A (old side), `to` = as of round B (new side). */
export type ComparedThread = Thread & { placement: 'from' | 'to'; outdatedIn: number | null };
export type UnplacedReason = 'base-side' | 'unchanged-file' | 'no-lines';
export type UnplacedThread = ComparedThread & { reason: UnplacedReason };

export interface ThreadCounts { open: number; resolved: number; outdated: number }
export interface FileState {
  path: string; oldPath: string | null; status: 'added' | 'deleted' | 'modified' | 'renamed';
  binary: boolean; tooLarge: boolean; additions: number; deletions: number; hunks: number;
  verdicts: { pending: number; accepted: number; rejected: number } | null;
  threads: ThreadCounts; unread: number;
}

export interface DiffLine { t: 'ctx' | 'add' | 'del'; old: number | null; new: number | null; text: string; noEol?: boolean }
export interface TextHunk {
  id: string; kind: 'text'; header: string; oldStart: number; oldLines: number; newStart: number; newLines: number;
  lines: DiffLine[]; verdict: Verdict | null;
}
export interface FileHunk { id: string; kind: 'file'; lines: []; verdict: Verdict | null }
export type Hunk = TextHunk | FileHunk;
/** A file in a diff response: FileState with its `hunks` and `threads` counts replaced by the lists. */
export type DiffFile = Omit<FileState, 'hunks' | 'threads'> & { hunks: Hunk[]; threads: Thread[] };

export interface Round { n: number; headSha: string; baseSha: string; createdAt: string; submittedAt: string | null }
export interface SubmissionRef { id: number | string; status: 'pending' | 'delivered' | 'failed' | 'superseded'; code: string | null; round: number }
export interface Submission extends SubmissionRef { recipient: string; text: string }

export interface ReviewSummary {
  id: string; project: string; worktree: string | null; branch: string | null; kind: Kind; target: unknown;
  label: string; title: string | null; status: 'open' | 'closed'; recipient: string | null; author: string | null; recipientRole: Role | null;
  round: number; headSha: string; baseSha: string; headMoved: boolean; dirty: boolean; checkoutGone: boolean;
  counts: { files: number | null; hunks: ({ pending: number; accepted: number; rejected: number } | { total: number }) | null; threads: ThreadCounts };
  mergeBlockers: number; unread: number; seenByHuman: boolean; rev: number; createdAt: string; createdBy: Author;
  lastSubmission: SubmissionRef | null;
  snapshotError?: 'CHECKOUT_GONE' | 'SNAPSHOT_GONE' | 'DIFF_TOO_LARGE' | 'SYSTEM_UNREACHABLE' | 'GIT_TIMEOUT' | 'GIT_UNAVAILABLE' | 'TEMP_UNUSABLE';
}

/** Whose move an open review waits on: 'agent' = waiting on the agent, 'human' = your turn (docs/protocol.md → InboxItem). */
export type Turn = 'human' | 'agent';
/** An open review as `GET /inbox` lists it; `checkoutGone` null = cc could not say. */
export interface InboxItem {
  id: string; project: string; worktree: string | null; branch: string | null; kind: Kind; label: string; title: string; round: number;
  unread: number; seenByHuman: boolean; lastActivityAt: string; turn: Turn; checkoutGone: boolean | null;
}

export interface Session { sessionId: string; project: string; worktree: string | null; label: string | null; status: string; live: boolean; conductor: boolean; conducted: boolean; attached: boolean }
/** A project the active session is working on; `main` = something of it is on the main checkout. */
export interface SessionPlace { project: string; main: boolean; worktrees: string[] }
export interface Commit { sha: string; short: string; author: string; date: string; subject: string; merge: boolean }
export interface ForkPoint { ref: string; label: string; forkSha: string }
export interface CheckoutInfo { project: string; worktree: string | null; path: string; branch: string | null; headSha: string | null; dirty: boolean; exists: boolean }

export interface RefreshReport {
  unchanged: boolean; round: number;
  hunks?: { kept: number; reset: number; new: number };
  threads?: { moved: number; drifted: number; outdated: number; dropped: number };
}

export type ThreadAnchorInput = { file: string; side?: Side; startLine: number; endLine?: number } | { hunkId: string };
