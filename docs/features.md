# Features

What the backend lets the human UI and agents do. Wire formats are in [protocol.md](protocol.md); internals in [architecture.md](architecture.md).

## Reviews and targets

A **review** is a persisted discussion about one checkout (a project's main checkout or one of its worktrees). Opening the same open target again returns the existing review (`reused: true`).

| Kind | Reviews | Old side | New side | Verdicts | Refresh |
|---|---|---|---|---|---|
| `range` | `base...HEAD`: the checkout's own commits | merge-base of `base` and HEAD | HEAD | yes | yes |
| `commit` | one commit (`sha`, default HEAD) | its first parent (empty tree for a root commit) | the commit | yes | refused `IMMUTABLE_TARGET` |
| `uncommitted` | working tree vs HEAD: staged, unstaged and untracked (not ignored) files | HEAD | the live working tree | none (`NO_VERDICTS`) | new round only when the diff changed |

- **Range base.** Defaults to the checkout's own fork point; a main checkout must name one (`BASE_REQUIRED`). A branch name is re-resolved through merge-base on every refresh, so after `sync_worktree` the range still shows only the checkout's own work; a sha base stays fixed. The UI offers the fork-point chain (subtask → feature → main) and any ancestor commit.
- **Committed history only.** Range and commit reviews never show uncommitted edits; the review carries a `dirty` flag instead.
- **Checkout gone** (worktree merged or deleted, project removed): range and commit reviews stay readable through the main checkout's objects; threads, replies and verdicts keep working; refresh is refused `CHECKOUT_GONE`. An uncommitted review lists its threads but has no diff.
- **Close / reopen / delete.** A closed review refuses content writes (`REVIEW_CLOSED`). Delete is a human-only hard delete. Nothing is removed automatically.

## Verdicts and hunks

- Each hunk carries `pending` (default), `accepted` or `rejected`. Only the human sets them; no MCP tool can.
- A hunk id hashes its file path and its added/removed lines, not line numbers or context. An edit elsewhere keeps the verdict; any change to the hunk's own lines resets it to pending.
- Binary files, pure renames, mode-only changes, empty files and over-size untracked files get one file-level hunk, so every change can carry a verdict. They accept no line anchors (`BINARY_FILE`).
- Renaming a file gives all its hunks new ids (the path is part of the hash).

## Threads

- **Kinds:** `comment`, `question`, `suggestion`, `finding`. A `finding` requires a `severity` (`blocker|major|minor|nit`).
- **Anchors:** a line range on the old or new side, or a whole hunk. Lines outside any hunk (context, expanded context) are allowed.
- **Resolve.** The human resolves or reopens any thread; a finding is resolved only with a disposition (`fixed` or `dismissed`). An agent's `reply` with `resolve: true` closes a non-finding thread it opened itself; otherwise the message is marked as proposing resolution. Replying never changes status.
- **Outdated.** After a refresh, a thread whose lines cannot be found becomes `outdated` (still repliable, no longer re-anchored).
- **Limits.** A message body is capped (`BODY_TOO_LARGE`). Prompts carry file paths with control characters removed.
- **Citations.** `path#L10-L20` in a message body (relative to the checkout root) is parsed; agents see the cited lines inlined at the message's round.
- **Unread.** A thread's unread count is the agent messages the human has not read; a review opened by an agent starts unseen. The human replying or marking read clears it.
- **Roles** are derived per review and frozen on each message: a caller from project `.conduct` is `conductor`; the recipient of a range/commit review is `author`; every other agent is `reviewer`. On an uncommitted review the human is the author, so every agent is a reviewer.
- **`mergeBlockers`** = rejected hunks + open `question` threads (open questions only on uncommitted reviews).

## Rounds and refresh

- A **round** is one snapshot epoch; messages record the round they were written in.
- `refresh` on a range review pins the new HEAD (and merge-base) as round n+1: verdicts of surviving hunks are kept, the rest reset to pending; threads follow their lines (`moved`), re-anchor by surrounding context (`drifted`), or go `outdated`. An unchanged HEAD reports `unchanged` and adds no round.
- `headMoved` on a range review means the checkout's HEAD differs from the pinned one: the UI's "refresh available" cue.
- **Uncommitted anchors are volatile.** Every read and write re-locates threads in the live working tree. A pure line shift moves the thread with its lines; changed or vanished lines delete the thread, and a later reply gets `THREAD_DROPPED`. Edits elsewhere in the same hunk never touch it.

## Submitting a round

- The human's activity since the last delivered submission is composed into a prompt for the **recipient** session (`POST …/submissions`): verdict tally, rejected hunks, threads with new human messages or status changes. Uncommitted reviews ask the recipient to review the changed files instead.
- The prompt is stored `pending`; the UI sends it through the cc bridge and reports the outcome. `delivered` stamps the round's `submittedAt`; a failure keeps it re-sendable; composing again supersedes undelivered ones. A first submission is always allowed; later ones need new human activity (`NOTHING_TO_SUBMIT`).
- **Recipient** defaults, first match: the explicit session, the calling session (MCP), the single live session attached to the checkout, none (`NO_RECIPIENT` on submit until set).

## Agent surface

- **MCP tools** (`code-review__<tool>`): `open_review`, `get_review`, `list_threads`, `get_hunk`, `annotate`, `reply`, `refresh_review`. Schemas and results: [protocol.md](protocol.md#mcp).
- **Skill** `review-dialog` (`skills/review-dialog/SKILL.md`): how an author or reviewer session works a review.
- **Conductor convention** `review-in-code-review` (`conventions/conductor-review.md`, scope `conductor`, opt-in per task): open a review on the worker's checkout, have reviewer lenses post findings, hold `merge_worktree` while `mergeBlockers` is above 0.
