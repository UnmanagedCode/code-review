import { api } from './api';
import type {
  CheckoutInfo, Commit, DiffFile, FileState, ForkPoint, Kind, RefreshReport, ReviewSummary, Round, Session,
  Severity, Submission, Thread, ThreadAnchorInput, ThreadKind, Verdict,
} from './types';

/** One typed function per REST call in docs/protocol.md; the only place `api/…` paths are built. */
const q = (params: Record<string, string | number | null | undefined>): string => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null) s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : '';
};
const json = (method: string, body?: unknown): RequestInit => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const r = (id: string) => `api/reviews/${encodeURIComponent(id)}`;

export interface ReviewDetail { review: ReviewSummary; files: FileState[]; rounds: Round[]; submissions: Submission[]; outdatedThreads: Thread[] }
export interface FileLines { path: string; side: 'old' | 'new'; total: number; lines: { n: number; text: string }[] }

export const projects = () => api<{ projects: { name: string }[] }>('api/projects');
export const checkout = (project: string, worktree: string | null) =>
  api<{ checkout: CheckoutInfo; forkPoints: ForkPoint[]; worktrees: { worktreeName: string; branch: string | null }[] }>(
    `api/checkout${q({ project, worktree })}`);
export const checkoutCommits = (project: string, worktree: string | null, limit?: number) =>
  api<{ commits: Commit[] }>(`api/checkout/commits${q({ project, worktree, limit })}`);
export const sessions = (project: string, worktree: string | null) =>
  api<{ sessions: Session[] }>(`api/sessions${q({ project, worktree })}`);

/** `worktree`: undefined = every checkout of the project, '' = main, else the named worktree. */
export const reviews = (project: string, worktree: string | undefined, status: string) =>
  api<{ reviews: ReviewSummary[] }>(`api/reviews${q({ project, worktree, status })}`);
export interface OpenInput { project: string; worktree: string | null; kind: Kind; base?: string; sha?: string; recipient?: string; title?: string }
export const openReview = (input: OpenInput) => api<{ review: ReviewSummary; reused: boolean }>('api/reviews', json('POST', input));
export const review = (id: string) => api<ReviewDetail>(r(id));
export const patchReview = (id: string, patch: { recipient?: string | null; title?: string; status?: 'open' | 'closed' }) =>
  api<{ review: ReviewSummary }>(r(id), json('PATCH', patch));
export const deleteReview = (id: string) => api<{ ok: true }>(r(id), json('DELETE'));
export const diff = (id: string, file?: string) => api<{ review: ReviewSummary; files: DiffFile[] }>(`${r(id)}/diff${q({ file })}`);
export const commitDiff = (id: string, commit: string) =>
  api<{ readOnly: true; commit: { sha: string; subject: string }; files: DiffFile[] }>(`${r(id)}/diff${q({ commit })}`);
export const fileLines = (id: string, path: string, side: 'old' | 'new', start: number, end: number) =>
  api<FileLines>(`${r(id)}/file${q({ path, side, start, end })}`);
export const setVerdict = (id: string, hunkId: string, verdict: Verdict) =>
  api<{ hunkId: string; verdict: Verdict; review: ReviewSummary }>(`${r(id)}/hunks/${encodeURIComponent(hunkId)}/verdict`, json('PUT', { verdict }));
export const acceptFile = (id: string, file: string, hunkIds: string[]) =>
  api<{ file: string; accepted: string[]; review: ReviewSummary }>(`${r(id)}/accept-file`, json('POST', { file, hunkIds }));
export const createThread = (id: string, input: { anchor: ThreadAnchorInput; kind: ThreadKind; severity?: Severity; body: string }) =>
  api<{ thread: Thread }>(`${r(id)}/threads`, json('POST', input));
export const replyThread = (id: string, tid: string, body: string) =>
  api<{ thread: Thread }>(`${r(id)}/threads/${encodeURIComponent(tid)}/messages`, json('POST', { body }));
export const setThreadStatus = (id: string, tid: string, status: 'open' | 'resolved', disposition?: 'fixed' | 'dismissed') =>
  api<{ thread: Thread }>(`${r(id)}/threads/${encodeURIComponent(tid)}`, json('PATCH', { status, ...(disposition ? { disposition } : {}) }));
export const refresh = (id: string) => api<RefreshReport>(`${r(id)}/refresh`, json('POST'));
export const compose = (id: string) => api<{ submission: Submission }>(`${r(id)}/submissions`, json('POST'));
export const submissionResult = (id: string, sid: string | number, result: { ok: boolean; code?: string }) =>
  api<{ submission: Submission }>(`${r(id)}/submissions/${encodeURIComponent(String(sid))}/result`, json('POST', result));
export const markRead = (id: string, threadId?: string) =>
  api<{ review: ReviewSummary }>(`${r(id)}/read`, json('POST', threadId ? { threadId } : {}));
export const reviewCommits = (id: string) => api<{ commits: Commit[] }>(`${r(id)}/commits`);
