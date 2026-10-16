# Features

What the UI and agents can do through the backend. Wire formats are in [protocol.md](protocol.md); internals in [architecture.md](architecture.md).

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
- **Accept file** accepts the listed pending hunks of one file in one write, each recorded exactly like a per-hunk accept. Hunks that already have a verdict (rejected ones included) keep it. The request names hunk ids, so a hunk added since the UI loaded stays pending, and an id that left the round refuses the whole request. There is no whole-file reject or undo; per-hunk Pending clears.

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

## Review UI

The plugin page. Wire calls are in [protocol.md](protocol.md); module layout in [architecture.md](architecture.md#frontend).

- **Screens.** Pick a project and worktree (CheckoutBar), list its reviews (this checkout or every checkout of the project; open, closed or all), start one (New review: range with a fork-point shortcut or any ancestor commit, one commit, or uncommitted), then work a review: header, file tree, one file's diff, thread panel.
- **Layouts.** Wide: left column (checkout and list, or the review header and file tree), the diff in the centre, the thread panel as a right column from `xl`; between `md` and `xl` the panel opens as a right sheet from a Threads button. Narrow (phone or a narrow docked pane): one pane per route (list → file tree → diff), the panel as a bottom sheet. The page follows cc's theme and has no theme control.
- **Diff.** Unified view only, with both line-number gutters; no syntax highlighting. Context outside the hunks is collapsed; a gap expands 20 lines at a time or fully, and a thread inside a gap opens it. The first 1 500 rows render, then "Show next …". Binary and too-large files show a placeholder with their verdict bar.
- **Per-hunk bar.** Accept / Reject / Pending (Pending clears) and "Comment on hunk" (anchors the whole hunk). Uncommitted reviews have no verdict controls; file-level hunks (binary, rename, mode) take a verdict but no comment; the commit-filter view has no bar.
- **File verdict.** The file header shows "a/n accepted" ("· r rejected" when any) and **Accept file**: disabled when nothing is pending or the review is closed, replaced by "All accepted" once every hunk is accepted, absent on uncommitted reviews and in the commit-filter view. Optimistic like per-hunk verdicts.
- **Selecting lines.** Mouse: drag over one side's gutter, shift+click to extend, a plain click restarts. Touch: tap a line, tap another to extend, tap an endpoint to clear. Keyboard: the diff is one tab stop; arrows move, ←/→ switch side, Shift+↑/↓ extend, Space/Enter select, `c` comments, Esc clears. A selection covers one side's numbers only and stops at collapsed context; expanding the gap lets it span two hunks. The toolbar under the selection ("L10–L14 (new)") appears when the pointer is released. No selection on binary or too-large files, closed reviews or the commit-filter view.
- **Threads.** Shown under their end line; several stack in id order. Each card has kind and severity badges, status, disposition, a "re-anchored by context" chip for drifted anchors, a "proposes resolution" chip and banner, author badges ("You", or the role plus the session title), a reply box and resolve controls (a finding resolves "as fixed" or "as dismissed"). Outdated threads appear only in the panel's Outdated tab, labelled with their old lines and round, with a reply box and no status controls.
- **Thread panel tabs.** This file; All (open/resolved filter, "Next unread"); Outdated; Dropped (uncommitted only). The All list is rebuilt whenever the review reloads (an SSE event, a write or the uncommitted poll), whether or not a file is open.
- **Message text.** Plain text. `path#L10-L20` citations become in-app links that open the file with the lines highlighted (a cited file outside the diff opens a read-only excerpt); `http(s)` URLs open in a new tab; nothing else is linked.
- **Commit filter.** Range reviews: choose one commit of the round to see its diff, read-only.
- **Rounds.** A range review whose HEAD moved shows "HEAD moved — Refresh available"; uncommitted reviews have a Refresh button; commit reviews have none. A refresh reports hunks kept/reset/new and threads moved/drifted/outdated/dropped, or "No changes; still round n".
- **Closed and gone.** A closed review disables every write and offers Reopen. A removed checkout shows a banner; an unreadable snapshot replaces the tree with the refusal text.
- **Live updates.** Review events refetch what is on screen; uncommitted reviews also refetch on window focus and every 15 s while the page is visible. Only verdicts (per hunk and Accept file) update before the server answers, and revert with a toast if refused.
- **Unread.** Badges come from the server. Focusing a thread (Focus button, `thread=` link, "Next unread") marks it read; "Mark all read" in the header actions menu clears the whole review, including the "new" badge.
- **Dropped threads.** An uncommitted thread whose lines changed is deleted by the backend. The UI keeps its last fetched copy for the current page session only, in the Dropped tab and as a one-line notice, labelled "dropped: its lines changed". A reload forgets them; replying to one is refused `THREAD_DROPPED`.
- **Submitting.** "Submit round" (range, commit) or "Request review" (uncommitted) composes the prompt. Embedded in cc, it is sent through the cc bridge: success is recorded and toasts "Sent to …"; a bridge failure is recorded with its code and shown with Retry (same submission), Open agent, Copy prompt and Mark as sent. If cc does not answer within the deadline nothing is recorded and the dialog warns that the prompt may already have arrived, so Retry could deliver it twice. A code the UI does not know is shown raw and not recorded. Standalone, the dialog shows the prompt with Copy and Mark as sent; Close leaves it pending. If the prompt was sent but recording its result fails (network error, 5xx), the dialog state resets and the review refetches, so the submission shows up as pending and the header offers "Re-send"; the failure is toasted. A submission left failed or pending is offered again as "Re-send" in the header. A failed one (the bridge reported an error) reads "Last submission failed (code)". A pending one reads "Last submission isn't recorded as delivered" and warns that it may already have reached the session, so re-sending could deliver it twice: its delivery is unknown after a reload, after a closed copy dialog, or when recording the result failed. With no recipient the recipient picker opens.
- **Session following.** Embedded, the checkout comes from the route, else cc's active session, else the last checkout used. Later session changes to a local project switch the checkout (replacing the history entry); a conductor or remote session leaves the view alone. "Open agent" focuses the recipient session. Standalone, none of this runs.
