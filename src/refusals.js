// Single source for refusal codes and their HTTP status. Services return
// `{ok:false, code, reason}`; low-level helpers throw `Refusal`, which `attempt` turns into the same shape.
export const HTTP_STATUS = {
  INVALID_ARGUMENT: 400, BAD_REF: 400, BASE_REQUIRED: 400, LINE_OUT_OF_RANGE: 400, SEVERITY_REQUIRED: 400, CALLER_UNKNOWN: 400,
  PROJECT_UNKNOWN: 404, CHECKOUT_UNKNOWN: 404, REF_UNKNOWN: 404, REVIEW_UNKNOWN: 404, THREAD_UNKNOWN: 404, HUNK_UNKNOWN: 404,
  FILE_NOT_IN_DIFF: 404, SUBMISSION_UNKNOWN: 404, COMMIT_NOT_IN_RANGE: 404, RECIPIENT_UNKNOWN: 404, ROUND_UNKNOWN: 404,
  PROJECT_NOT_LOCAL: 409, CHECKOUT_GONE: 409, NO_COMMON_ANCESTOR: 409, UNBORN_HEAD: 409, IMMUTABLE_TARGET: 409, NO_VERDICTS: 409,
  REVIEW_CLOSED: 409, BINARY_FILE: 409, NO_RECIPIENT: 409, NOTHING_TO_SUBMIT: 409, SUBMISSION_NOT_PENDING: 409, THREAD_DROPPED: 409,
  SNAPSHOT_GONE: 410,
  DIFF_TOO_LARGE: 413,
  BODY_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  CONDUCTOR_UNAVAILABLE: 502,
  STORE_UNCONFIGURED: 503,
};

export class Refusal extends Error {
  constructor(code, reason) {
    super(reason);
    this.code = code;
  }
}

export const refuse = (code, reason) => ({ ok: false, code, reason });
export const isRefusal = (x) => x?.ok === false && typeof x.code === 'string';

/** Runs `fn`; a thrown `Refusal` becomes a refusal object, anything else propagates. */
export async function attempt(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Refusal) return refuse(e.code, e.message);
    throw e;
  }
}
