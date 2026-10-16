/** Wording for backend refusal codes (`HTTP_STATUS` in src/refusals.js) and cc bridge codes: the one place UI copy for them lives. */
const BACKEND: Record<string, string> = {
  STORE_UNCONFIGURED: "Review store isn't configured: set CODE_REVIEW_STORE or PROJECTS_ROOT",
  CONDUCTOR_UNAVAILABLE: "Can't reach code-conductor; project and session lists are unavailable",
  PROJECT_UNKNOWN: 'Project unknown',
  PROJECT_NOT_LOCAL: 'This project lives on a remote system and can’t be reviewed here',
  CHECKOUT_UNKNOWN: 'That worktree no longer exists',
  CHECKOUT_GONE: 'The checkout was removed; the review stays readable but can’t refresh',
  BASE_REQUIRED: 'Pick a base to review against',
  BAD_REF: 'That is not a valid git ref',
  REF_UNKNOWN: 'That ref does not exist in this checkout',
  NO_COMMON_ANCESTOR: 'The base and HEAD share no history',
  UNBORN_HEAD: 'This checkout has no commits yet',
  REVIEW_UNKNOWN: 'Review not found (it may have been deleted)',
  SNAPSHOT_GONE: 'A pinned commit was garbage-collected, so the diff is gone',
  DIFF_TOO_LARGE: 'The diff is too large to show',
  REVIEW_CLOSED: 'The review is closed; reopen it to change it',
  NO_VERDICTS: 'Uncommitted reviews take no verdicts',
  IMMUTABLE_TARGET: 'This review’s target is a fixed commit, so it can’t be refreshed',
  HUNK_UNKNOWN: 'The diff changed under you; reloaded',
  FILE_NOT_IN_DIFF: 'The diff changed under you; reloaded',
  LINE_OUT_OF_RANGE: 'The diff changed under you; reloaded',
  BINARY_FILE: 'Binary files take no line comments',
  THREAD_DROPPED: 'Its lines changed, so the thread was dropped',
  THREAD_UNKNOWN: 'Thread not found',
  SEVERITY_REQUIRED: 'A finding needs a severity',
  BODY_TOO_LARGE: 'That message is too long',
  INVALID_ARGUMENT: 'The request was invalid',
  NO_RECIPIENT: 'Pick a recipient session first',
  NOTHING_TO_SUBMIT: 'Nothing new to submit since the last delivery',
  SUBMISSION_UNKNOWN: 'Submission not found',
  SUBMISSION_NOT_PENDING: 'Already recorded',
  RECIPIENT_UNKNOWN: 'That session no longer exists',
  COMMIT_NOT_IN_RANGE: 'That commit is not in this review’s range',
  UNSUPPORTED_MEDIA_TYPE: 'Unexpected backend error',
  INTERNAL: 'Unexpected backend error',
};
const WITH_REASON = new Set(['INVALID_ARGUMENT', 'BODY_TOO_LARGE', 'SEVERITY_REQUIRED', 'UNSUPPORTED_MEDIA_TYPE', 'INTERNAL']);

export const UNREACHABLE = "Can't reach the code-review backend";

export function messageFor(code: string | undefined, reason?: string): string {
  if (!code) return UNREACHABLE;
  const base = BACKEND[code] ?? `Unexpected refusal ${code}`;
  return reason && (WITH_REASON.has(code) || !(code in BACKEND)) ? `${base}: ${reason}` : base;
}

/** Errors from `api()` → text for a toast or ErrorState. */
export function errorText(e: unknown): string {
  if (e && typeof e === 'object' && 'code' in e && 'reason' in e) return messageFor((e as { code?: string }).code, (e as { reason: string }).reason);
  return UNREACHABLE;
}

/** Codes whose refusal means the visible diff is stale. */
export const STALE_DIFF = new Set(['HUNK_UNKNOWN', 'FILE_NOT_IN_DIFF', 'LINE_OUT_OF_RANGE']);

export const BRIDGE_CODES = ['INVALID_ARGUMENT', 'SESSION_UNKNOWN', 'SESSION_NOT_LIVE', 'SESSION_NOT_READY', 'SEND_FAILED', 'LOOKUP_FAILED', 'HOST_ERROR'] as const;
const BRIDGE: Record<(typeof BRIDGE_CODES)[number], string> = {
  INVALID_ARGUMENT: 'cc refused the prompt as invalid',
  SESSION_UNKNOWN: 'That session no longer exists',
  SESSION_NOT_LIVE: "The session isn't running",
  SESSION_NOT_READY: 'The session is busy or switching models — retry shortly',
  SEND_FAILED: 'cc could not deliver the prompt to the session',
  LOOKUP_FAILED: "cc couldn't look the session up",
  HOST_ERROR: 'cc hit an unexpected error',
};
export const isBridgeCode = (c: string): c is (typeof BRIDGE_CODES)[number] => (BRIDGE_CODES as readonly string[]).includes(c);
export const bridgeMessage = (code: string): string => (isBridgeCode(code) ? BRIDGE[code] : `cc answered with an unrecognised code (${code})`);
