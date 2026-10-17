# Protocol

REST under `/api` (JSON), an SSE stream, and the cc MCP endpoint. Behaviour behind each is in [features.md](features.md). UI code calls these as relative `api/…` URLs.

## Conventions

- Success: `{ok: true, …}`. Refusal: `{ok: false, code, reason}` with the HTTP status from the table below. An unexpected exception is `500 {ok:false, code:'INTERNAL', reason}`. Malformed JSON is `400 INVALID_ARGUMENT`. An unrouted `/api/*` path is `404 {error}`.
- **Mutating requests (any method but GET/HEAD/OPTIONS, `POST /mcp` included) must send `Content-Type: application/json`, even with no body** (the UI's `api()` helper does), else `415 UNSUPPORTED_MEDIA_TYPE`. A cross-site HTML form cannot send that type, so it cannot trigger `refresh` or `submissions`.
- **Limits:** a message or thread body is at most `MAX_BODY_CHARS` (20 000, `src/threads.js`) characters, else `413 BODY_TOO_LARGE`. The SSE feed has no client cap (the store's change emitter has no listener limit; listeners are removed on disconnect).
- `worktree: ""` means the main checkout, like an omitted or `null` one, in `POST /reviews` and MCP `open_review`.
- Source of truth for codes and statuses: `HTTP_STATUS` in `src/refusals.js`.
- Env: `CODE_REVIEW_STORE` (store dir) else `$PROJECTS_ROOT/.code-review`; `CONDUCTOR_URL` (cc base URL, injected by cc); `CODE_REVIEW_CC_TIMEOUT_MS` (cc call timeout, default 3000); `PORT` (default 7400).

## Refusal codes

| Status | Codes |
|---|---|
| 400 | `INVALID_ARGUMENT` `BAD_REF` `BASE_REQUIRED` `LINE_OUT_OF_RANGE` `SEVERITY_REQUIRED` `CALLER_UNKNOWN` |
| 404 | `PROJECT_UNKNOWN` `CHECKOUT_UNKNOWN` `REF_UNKNOWN` `REVIEW_UNKNOWN` `THREAD_UNKNOWN` `HUNK_UNKNOWN` `FILE_NOT_IN_DIFF` `SUBMISSION_UNKNOWN` `COMMIT_NOT_IN_RANGE` `RECIPIENT_UNKNOWN` `ROUND_UNKNOWN` `AUTHOR_UNKNOWN` (MCP only) |
| 409 | `PROJECT_NOT_LOCAL` `CHECKOUT_GONE` `NO_COMMON_ANCESTOR` `UNBORN_HEAD` `IMMUTABLE_TARGET` `NO_VERDICTS` `REVIEW_CLOSED` `BINARY_FILE` `NO_RECIPIENT` `NOTHING_TO_SUBMIT` `SUBMISSION_NOT_PENDING` `THREAD_DROPPED` |
| 410 | `SNAPSHOT_GONE` (a pinned sha was garbage-collected) |
| 413 | `DIFF_TOO_LARGE` `BODY_TOO_LARGE` |
| 415 | `UNSUPPORTED_MEDIA_TYPE` |
| 502 | `CONDUCTOR_UNAVAILABLE` |
| 503 | `STORE_UNCONFIGURED` (the server still serves `/health` and the UI) |

## Shapes

- **ReviewSummary:** `id, project, worktree, branch, kind, target, label, title, status, recipient, author|null, recipientRole, round, headSha, baseSha, headMoved, dirty, checkoutGone, counts:{files, hunks, threads:{open,resolved,outdated}}, mergeBlockers, unread, seenByHuman, rev, createdAt, createdBy, lastSubmission:{id,status,code,round}|null`.
  - `counts.hunks` is `{pending,accepted,rejected}`, or `{total}` for uncommitted reviews.
  - `snapshotError` (`CHECKOUT_GONE|SNAPSHOT_GONE|DIFF_TOO_LARGE`) is present when the diff is unreadable; `counts.files` and `counts.hunks` are then `null`.
- **FileState:** `path, oldPath, status (added|deleted|modified|renamed), binary, tooLarge, additions, deletions, hunks (count), verdicts:{pending,accepted,rejected}|null, threads:{open,resolved,outdated}, unread`.
- **Hunk:** text `{id, kind:'text', header, oldStart, oldLines, newStart, newLines, lines:[{t:'ctx'|'add'|'del', old, new, text, noEol?}], verdict}`; file-level `{id, kind:'file', lines:[], verdict}`. `verdict` is `null` for uncommitted reviews, in the commit filter view and in past-round views.
- **Thread:** `id, kind, severity, status (open|resolved|outdated), disposition, resolveProposed, anchor:{file, side, startLine, endLine, hunkId, round, linesHash, drifted}, openedBy, unread, messages:[{id, author, body, at, round, proposeResolve, citations:[{raw,path,startLine,endLine}]}]`.
- **`anchor.round`:** the round whose snapshot the anchor's `lines` and `linesHash` come from: the round the thread was created in, advanced to the new round whenever a refresh re-anchors it. On a range review the anchor it had in each earlier round is kept and past-round views show it. A message's own `round` never changes.
- **Thread in a past-round view** (`GET /reviews/:id/rounds/:n`, `diff?round=`): the same shape as of round n, plus `laterMessages` (messages written after round n, not included). `messages` stop at round n; `unread` is 0; `resolveProposed` is false; `status` is its current one, except that a thread outdated after round n shows `resolved` if it carries a resolution, else `open`. Past rounds are views of range reviews only.
- **`anchor.drifted`:** true only if the latest re-anchoring found the thread by surrounding context; finding the exact lines again clears it.
- **Author:** `{kind:'human'}` or `{kind:'session', sessionId, role: author|reviewer|conductor}`.
- **Session:** `sessionId, project, worktree, title, status, live, conductor, conducted, attached`.

## Endpoints

| Method + path | Request | Success body | Refusals |
|---|---|---|---|
| `GET /projects` | | `{projects:[{name}]}` (local only) | `CONDUCTOR_UNAVAILABLE` |
| `GET /checkout` | `?project&worktree` (omit `worktree` for main) | `{checkout:{project, worktree, path, branch, headSha, dirty, exists}, forkPoints:[{ref,label,forkSha}], worktrees:[{worktreeName,branch}]}` | `INVALID_ARGUMENT`, `PROJECT_*`, `CHECKOUT_UNKNOWN` |
| `GET /checkout/commits` | `?project&worktree&limit` (default 50, max 500) | `{commits:[{sha, short, author, date, subject, merge}]}` | as above, `CHECKOUT_GONE` |
| `GET /sessions` | `?project&worktree` | `{sessions:[Session]}` (all cc sessions; `attached` is relative to the checkout) | `INVALID_ARGUMENT`, `CONDUCTOR_UNAVAILABLE` |
| `GET /reviews` | `?project&worktree&status`; no `worktree` = every checkout, empty `worktree=` = main | `{reviews:[ReviewSummary]}` newest first | |
| `POST /reviews` | `{project, worktree|null, kind?, base?, sha?, recipient?, title?}` (`author` is refused `INVALID_ARGUMENT`: the human path takes none) | `{review, reused}` | `INVALID_ARGUMENT` `BAD_REF` `REF_UNKNOWN` `BASE_REQUIRED` `NO_COMMON_ANCESTOR` `UNBORN_HEAD` `PROJECT_*` `CHECKOUT_*` `RECIPIENT_UNKNOWN` |
| `GET /reviews/:id` | | `{review, files:[FileState], rounds, submissions, outdatedThreads:[Thread]}` | `REVIEW_UNKNOWN` |
| `PATCH /reviews/:id` | `{recipient? (null clears), title?, status?: open|closed}` | `{review}` | `RECIPIENT_UNKNOWN` |
| `DELETE /reviews/:id` | | `{ok}` | `REVIEW_UNKNOWN` |
| `GET /reviews/:id/diff` | `?file` optional | `{review, files:[FileState + {hunks:[Hunk], threads:[Thread]}]}`; threads are the non-outdated ones on that file | `FILE_NOT_IN_DIFF` `SNAPSHOT_GONE` `CHECKOUT_GONE` `DIFF_TOO_LARGE` |
| `GET /reviews/:id/diff?commit=<sha>` | range reviews; sha or ≥7-char prefix | `{readOnly:true, commit:{sha,subject}, files}` (hunk verdicts `null`, no threads) | `COMMIT_NOT_IN_RANGE`, `INVALID_ARGUMENT` for other kinds |
| `GET /reviews/:id/diff?round=<n>` | range reviews; `n` a stored round (the current one included); `file` optional | `{readOnly:true, round:Round, files:[FileState + {hunks, threads}]}` as of round n: hunk and file verdicts `null`; threads are those placed in that file then and not outdated by then (past-round Thread shape) | `ROUND_UNKNOWN` `FILE_NOT_IN_DIFF` (not in that round) `SNAPSHOT_GONE` `CHECKOUT_GONE`; `INVALID_ARGUMENT` for other kinds, a non-positive-integer `n`, or with `commit` |
| `GET /reviews/:id/rounds/:n` | range reviews; `n` as above | `{readOnly:true, round:Round, files:[FileState] (verdicts null, thread counts and unread as of then), counts:{open,resolved,outdated}, outdatedThreads:[Thread]}` | `ROUND_UNKNOWN` `SNAPSHOT_GONE` `CHECKOUT_GONE` `REVIEW_UNKNOWN`; `INVALID_ARGUMENT` as above |
| `GET /reviews/:id/commits` | | `{commits}` of the current round (range: `baseSha..headSha`; commit: that one; uncommitted: none) | |
| `GET /reviews/:id/file` | `?path&side=old|new&start&end&round` (`round`: range reviews, read that round instead of the current one; refusals as for `diff?round`) | `{path, side, total, lines:[{n,text}]}` | `LINE_OUT_OF_RANGE` `FILE_NOT_IN_DIFF` (path absent on that side) `BINARY_FILE` (the snapshot's binary flag, so `-diff` attributes count) |
| `PUT /reviews/:id/hunks/:hunkId/verdict` | `{verdict: pending|accepted|rejected}` (`pending` clears) | `{hunkId, verdict, review}` | `NO_VERDICTS` `HUNK_UNKNOWN` `REVIEW_CLOSED` `INVALID_ARGUMENT` |
| `POST /reviews/:id/accept-file` | `{file, hunkIds:[id]}` (ids of that file's hunks, as shown pending) | `{file, accepted:[hunkId], review}` (`accepted` = ids that changed; ids with a verdict are skipped) | `NO_VERDICTS` `FILE_NOT_IN_DIFF` `HUNK_UNKNOWN` (any id not in that file this round; nothing written) `REVIEW_CLOSED` `INVALID_ARGUMENT` |
| `POST /reviews/:id/threads` | `{anchor:{file,side?,startLine,endLine?}|{hunkId}, kind, severity?, body}` | `{thread}` (human-authored) | `LINE_OUT_OF_RANGE` `FILE_NOT_IN_DIFF` `BINARY_FILE` `HUNK_UNKNOWN` `SEVERITY_REQUIRED` `INVALID_ARGUMENT` `REVIEW_CLOSED` |
| `POST /reviews/:id/threads/:tid/messages` | `{body}` | `{thread}` | `THREAD_UNKNOWN` `THREAD_DROPPED` `REVIEW_CLOSED` |
| `PATCH /reviews/:id/threads/:tid` | `{status: resolved|open, disposition?: fixed|dismissed}` | `{thread}` | `INVALID_ARGUMENT` (finding without disposition, outdated thread) `THREAD_*` |
| `POST /reviews/:id/refresh` | | `{unchanged, round, hunks:{kept,reset,new}, threads:{moved,drifted,outdated,dropped}}`; `unchanged:true` carries only `round` | `IMMUTABLE_TARGET` `CHECKOUT_GONE` `REVIEW_CLOSED` `REF_UNKNOWN` `NO_COMMON_ANCESTOR` |
| `POST /reviews/:id/submissions` | | `{submission:{id, round, recipient, text, status}}` | `NO_RECIPIENT` `NOTHING_TO_SUBMIT` `REVIEW_CLOSED` |
| `POST /reviews/:id/submissions/:sid/result` | `{ok, code?}` | `{submission}` | `SUBMISSION_UNKNOWN` `SUBMISSION_NOT_PENDING` `INVALID_ARGUMENT` |
| `POST /reviews/:id/read` | `{threadId?}` (none = whole review) | `{review}` | `THREAD_UNKNOWN` |
| `GET /events` | | SSE | |
| `POST /mcp` | cc envelope | see [MCP](#mcp) | |

### SSE

`event: review` with data `{id, rev}` after every stored write, or `{id, deleted:true}` after a delete. A `: heartbeat` comment every 25 s. Uncommitted working-tree edits emit nothing: the UI re-fetches an uncommitted diff on focus or an interval.

### Submission delivery

1. `POST …/submissions` stores the prompt `pending` and returns its text.
2. The UI sends `text` to `recipient` through the cc bridge, then posts `{ok:true}` or `{ok:false, code}`.
3. `code` is the bridge's, stored verbatim: `INVALID_ARGUMENT`, `SESSION_UNKNOWN`, `SESSION_NOT_LIVE`, `SESSION_NOT_READY`, `SEND_FAILED`, `LOOKUP_FAILED`, `HOST_ERROR`. Any other value is refused `INVALID_ARGUMENT`.
4. Only `pending` or `failed` submissions accept a result (`SUBMISSION_NOT_PENDING` otherwise), so a failed one can be re-sent and re-reported. Without a bridge the UI shows the text and posts `{ok:true}` for "mark as sent".

## MCP

- Endpoint `/api/mcp`; tools are namespaced `code-review__<tool>` by cc. Schemas are flat (`type`, `enum`, `minLength`, `minimum`, `default`, `description`); the definitions are in `conductor.plugin.json`.
- Envelope `{tool, arguments, caller:{sessionId, project}}`: missing `tool` → 400; unknown tool → `200 {error}`; a refusal → `200 {result:{ok:false, code, reason}}`; an exception → `200 {error}`.
- Header fields in text results (paths, labels, thread locations, hunk headers) have control characters stripped; code lines and message bodies are verbatim.
- Writes (`open_review`, `annotate`, `reply`, `refresh_review`) refuse `CALLER_UNKNOWN` without `caller.sessionId`.
- No tool sets a verdict.
- **Trust:** `caller` comes from cc over unauthenticated loopback, so any local process can forge an agent identity, including a reviewer that resolves its own question and clears `mergeBlockers`. This is no wider than the REST surface, which already acts as the human. There is no token; one would need a cc change.

| Tool | Required | Result |
|---|---|---|
| `open_review` | | `{result:{ok, review:ReviewSummary, reused}}`. Checkout: `project`+`worktree`; without `project`, `worktree` must be absent and the checkout is the caller's (`CHECKOUT_UNKNOWN` if cc does not know the caller); a conductor caller must name `project` (`INVALID_ARGUMENT`). Recipient: the caller. `author`: conductor callers only, range/commit only (else `INVALID_ARGUMENT`); `AUTHOR_UNKNOWN` if cc does not know the session. A reused review is returned unchanged. The creator is the caller; `seenByHuman:false`. |
| `get_review` | `review` | `{text: per-file table, meta: ReviewSummary}` |
| `list_threads` | `review` | `{text, meta:{review, count, counts}}`; `status` default `open`; cited code inlined as `path#L… @<short sha | working tree>`, ≤ 80 lines then `… (truncated)`, unresolvable ones `(unresolved: …)` |
| `get_hunk` | `review` + `hunk` or `file` | `{text: hunk with old/new line gutters, meta:{file, hunks:[{id, verdict, threadIds}]}}`; `file`+`line` picks the hunk covering that new-side line |
| `annotate` | `review kind body` | `{result:{ok, thread}}`; needs `file`+`startLine` or `hunk`; `severity` required for a finding |
| `reply` | `review thread body` | `{result:{ok, thread}}` |
| `refresh_review` | `review` | `{result:{ok, round, unchanged, hunks, threads}}` |

## cc routes consumed

All through `CONDUCTOR_URL`, 3 s timeout; any failure is `CONDUCTOR_UNAVAILABLE`.

| Route | Fields used |
|---|---|
| `GET /api/projects` | `name`, `path`, `system` (absent or `local` = local) |
| `GET /api/projects/:name/worktrees` | `worktreeName`, `worktreePath`, `branch`, `baseBranch`, `baseSha`, `baseWorktree?` (absent = forked from the main checkout) |
| `GET /api/instances` | `sessionId`, `project`, `status`, `title`, `conducted`, `worktree.worktreeName` |

- A session is live unless `status` is `exited` or `crashed`. The conductor is the session whose `project` is `.conduct`.
- The `sessionIds` lists on the other cc routes are not liveness-filtered and are not used.
- cc stores no session role, so author/reviewer/conductor is derived per review.

## UI routes

The page keeps its state in the query string (`?…`, never the hash) and writes it with `history.pushState`; cc's `navigate` message arrives as `popstate`. Unknown parameters are dropped.

| Param | Meaning |
|---|---|
| `project` | The checkout's project; absent = not chosen |
| `worktree` | Worktree name; absent = main checkout |
| `review` | Review id |
| `file` | A path in the diff, or a cited path outside it |
| `side` | `old` or `new`, for `lines` (default `new`) |
| `lines` | `10` or `10-20`: highlight, scroll to, and expand context to reach it |
| `thread` | Focused thread: scrolled to, panel opened, marked read |
| `commit` | Range reviews: commit-filter view (read-only) |
| `round` | Range reviews: past-round view (read-only), a positive integer; ignored with `commit`, dropped when it names the current round or a later one. Focusing a thread there marks nothing read |
| `view` | `new` (New review dialog) or `threads` (thread panel on narrow layouts) |

**Citation links.** A message citation (`path#L10-L20`) renders as `?<route>&file=<path>&side=new&lines=10-20`, built from the route serialiser, never from the message text. Paths that start with `/` or contain a `..` segment are left as text, like the backend's citation resolver. A markdown link whose destination is a listed citation (`[label](path#L10-L20)`) renders the same route link, labelled by its label.
