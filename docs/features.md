# Features

What the UI and agents can do through the backend. Wire formats are in [protocol.md](protocol.md); internals in [architecture.md](architecture.md).

## Reviews and targets

A **review** is a persisted discussion about one checkout (a project's main checkout or one of its worktrees). Opening the same open target again returns the existing review unchanged (`reused: true`): its recipient and author stay.

| Kind | Reviews | Old side | New side | Verdicts | Refresh |
|---|---|---|---|---|---|
| `range` | `base...HEAD`: the checkout's own commits | merge-base of `base` and HEAD | HEAD | yes | yes |
| `commit` | one commit (`sha`, default HEAD) | its first parent (empty tree for a root commit) | the commit | yes | refused `IMMUTABLE_TARGET` |
| `uncommitted` | working tree vs HEAD: staged, unstaged and untracked (not ignored) files | HEAD | the live working tree | none (`NO_VERDICTS`) | new round only when the diff changed |

- **Range base.** Defaults to the checkout's own fork point; a main checkout must name one (`BASE_REQUIRED`). A branch name is re-resolved through merge-base on every refresh, so after `sync_worktree` the range still shows only the checkout's own work; a sha base stays fixed. The UI offers the fork-point chain (subtask → feature → main) and any ancestor commit.
- **Committed history only.** Range and commit reviews never show uncommitted edits; the review carries a `dirty` flag instead.
- **Checkout gone** (worktree merged or deleted, project removed): range and commit reviews stay readable through the main checkout's objects; threads, replies and verdicts keep working; refresh is refused `CHECKOUT_GONE`. An uncommitted review lists its threads but has no diff.
- **Projects on a System.** A project cc places on another System (a container, a remote host) is reviewed like a local one: every git command and working-tree read runs on that System through cc's `POST /api/exec`. The project picker lists every cc project.
- **System down.** While a project's System cannot be reached (or git there times out or cannot start), its reviews stay in the list, marked with the reason (`snapshotError` `SYSTEM_UNREACHABLE`, `GIT_TIMEOUT` or `GIT_UNAVAILABLE`, never "checkout gone"); threads and replies stay readable, an uncommitted review's threads are left as they were, and opening, refreshing, the diff and the checkout picker are refused with that code until it answers again.
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
- **Roles** are derived per review and frozen on each message: a caller from project `.conduct` is `conductor`; the review's stored `author`, else its recipient, is `author` on a range/commit review; every other agent is `reviewer`. The summary's `recipientRole` is `conductor` when the recipient is the conductor session that opened the review. On an uncommitted review the human is the author, so no agent is: a non-conductor agent is a `reviewer`.
- **`mergeBlockers`** = rejected hunks + open `question` threads (open questions only on uncommitted reviews).

## Rounds and refresh

- A **round** is one snapshot epoch; messages record the round they were written in.
- `refresh` on a range review pins the new HEAD (and merge-base) as round n+1: verdicts of surviving hunks are kept, the rest reset to pending; threads follow their lines (`moved`), re-anchor by surrounding context (`drifted`), or go `outdated`. An unchanged HEAD reports `unchanged` and adds no round.
- `headMoved` on a range review means the checkout's HEAD differs from the pinned one: the UI's "refresh available" cue.
- **Past rounds** (range reviews only) are viewable read-only, rebuilt from the round's pinned base and head. A range refresh records each thread's previous anchor (uncommitted reviews record none):
  - each thread sits at the anchor it had in that round (its file path then, its drift flag then);
  - messages written in later rounds are hidden and counted (`laterMessages`);
  - threads opened in a later round are absent;
  - a thread outdated in a later round shows the status it had before it went outdated; one outdated by then is outdated, at its last located anchor;
  - open/resolved is otherwise the thread's current status, and there are no verdicts, no unread counts and no proposed resolutions.
- **Comparing rounds** (range reviews only, read-only): round A's head against round B's head, A before B.
  - **Files:** those changed between the two heads that either round reviews (`path` in round B's diff, or `oldPath ?? path` in round A's). Upstream churn merged in between stays out; a file reverted to base in B stays in. Inside a kept file every line that differs between the heads shows, upstream edits included.
  - **Threads:** each thread live in round A sits on the left (old side) at its round-A lines, as of round A (later replies hidden and counted); each thread live in round B on the right at its round-B lines, as of B. Notes say "round A L… · outdated in round k" or "… · still applies in round B" (left copies) and "round B L…" (right copies).
  - **One card per row:** when both copies of a thread fall under one row (a context line, or a deleted/added pair in split), it shows once, as its round-B copy, noted with both positions.
  - **Not in diff:** base-side threads, threads in files unchanged between the rounds, and threads on binary/too-large files are listed in the thread panel's Not in diff tab with the reason.
  - **Inline / phone:** one combined diff. Deleted lines are round A's, added lines round B's, context lines both; a thread on a changed line shows twice (under its deleted and its added line), one on an unchanged line once.
  - Threads outdated by round A, or opened after round B, are not in the comparison (the round-A view lists the former).
- **Uncommitted anchors are volatile.** Every read and write re-locates threads in the live working tree. A pure line shift moves the thread with its lines; changed or vanished lines delete the thread, and a later reply gets `THREAD_DROPPED`. Edits elsewhere in the same hunk never touch it.

## Submitting a round

- The human's activity since the last delivered submission is composed into a prompt for the **recipient** session (`POST …/submissions`): verdict tally, rejected hunks, threads with new human messages or status changes. Uncommitted reviews ask the recipient to review the changed files instead. A conductor recipient is asked to relay the round to the author (range/commit) or to brief a reviewer (uncommitted).
- The prompt is stored `pending`; the UI sends it through the cc bridge and reports the outcome. `delivered` stamps the round's `submittedAt`; a failure keeps it re-sendable; composing again supersedes undelivered ones. A first submission is always allowed; later ones need new human activity (`NOTHING_TO_SUBMIT`).
- **Recipient.** An agent-opened review: the opening session. A human-opened one: the explicit session, else the single live session attached to the checkout, else none (`NO_RECIPIENT` on submit until set).
- **Author.** A conductor opening a range/commit review names the worker with `author`; the stored session takes the author role while the conductor stays recipient and relays the rounds.

## Agent surface

- **MCP tools** (`code-review__<tool>`): `open_review`, `get_review`, `list_threads`, `get_hunk`, `annotate`, `reply`, `refresh_review`. Schemas and results: [protocol.md](protocol.md#mcp).
- **Skill** `review-dialog` (`skills/review-dialog/SKILL.md`): how an author or reviewer session works a review.
- **Conductor convention** `review-in-code-review` (`conventions/conductor-review.md`, scope `conductor`, opt-in per task): open a review on the worker's checkout naming the worker as author, relay its rounds to the worker, have reviewer lenses post findings, hold `merge_worktree` while `mergeBlockers` is above 0.

## Review UI

The plugin page. Wire calls are in [protocol.md](protocol.md); module layout in [architecture.md](architecture.md#frontend).

- **Screens.** Pick a project and worktree (CheckoutBar), list its reviews (this checkout or every checkout of the project; open, closed or all), start one (New review: range with a fork-point shortcut or any ancestor commit, one commit, or uncommitted), then work a review: header, file tree, one file's diff, thread panel.
- **Review header.** Shows the recipient (a button opening the picker) and, when the review names one, a plain `Author: <session title>` text.
- **Layouts.** Wide: left column (checkout and list, or the review header and file tree), the diff in the centre, the thread panel as a right column from `xl`; between `md` and `xl` the panel opens as a right sheet from a Threads button. Narrow (phone or a narrow docked pane): one pane per route (list → file tree → diff), the panel as a bottom sheet. The page follows cc's theme and has no theme control.
  - **Resizable thread column** (`xl` only): drag its left edge, or focus the handle ("Resize threads panel") and use ←/→ (16px), Shift+←/→ (64px), Home (narrowest), End (widest). The width stays between the panel's minimum and maximum and always leaves the diff pane its minimum while the window allows (`PANEL_MIN_PX`, `PANEL_MAX_PX`, `DIFF_MIN_PX` in `frontend/src/lib/panelWidth.ts`); a narrower window narrows the panel without forgetting the chosen width. Remembered in this browser (`code-review:threadPanelWidth`). The `md`–`xl` right sheet and the phone bottom sheet have fixed sizes.
- **Diff.** Inline (unified, the default) or split, both with both line-number gutters; no syntax highlighting or word diff. Split pairs each run of deletions with the additions after it side by side (the n-th deletion beside the n-th addition, the shorter side padded with empty cells), shows context on both sides, and wraps long lines; inline scrolls long lines sideways. Context outside the hunks is collapsed; a gap expands 20 lines at a time or fully, and a thread inside a gap opens it. The first 1 500 rows render, then "Show next …". Binary and too-large files show a placeholder with their verdict bar.
- **Diff view.** The Inline / Split toggle sits in the file header of a text diff and is remembered in this browser (`code-review:diffView`). Split needs the wide layout and a diff pane at least `SPLIT_MIN_PX` (36rem, `frontend/src/features/diff/useDiffView.ts`) wide, and once shown it stays until the pane is narrower than `SPLIT_MIN_PX − SPLIT_EXIT_SLACK_PX`; below that the diff is inline, the toggle is hidden and the stored choice is kept. The view follows the pane width live (window, cc's dock pane, or the thread column's width), so at 1280px with the default thread column the diff is inline. Phones are always inline.
- **Settled items.** An accepted hunk and a resolved thread show as a one-line summary (the hunk's `@@` header with "accepted"; the thread's kind, the first line of its first message as plain text, "resolved" and its disposition); click to expand, and the chevron collapses again. Expanding only changes the view and is forgotten on reload or file switch. Un-accepting or reopening expands the item; settling it again collapses it. A collapsed hunk has no verdict bar (expand it to change the verdict); its open threads stay listed under its summary. A hunk holding the current selection offers no collapse control. The thread named by `thread=` and every hunk holding the `lines=` range are always expanded. Accepting a hunk that holds the current selection keeps it expanded. No collapsing in uncommitted reviews, the commit filter or past rounds (no verdicts there; resolved threads still collapse), nor in the thread panel.
- **Drafts.** An unsent reply (per thread) or new comment (per anchored range or hunk, with its kind and severity) is kept for the browser session, so it survives its form moving or remounting: a hunk collapsing over the thread, a view flip, closing and reopening the same range. Sending clears it; Cancel discards a new comment's draft. A reload loses drafts.
- **Per-hunk bar.** Accept / Reject / Pending (Pending clears) and "Comment on hunk" (anchors the whole hunk). The active verdict carries the primary (coral/orange) accent tint, same for every verdict. Uncommitted reviews have no verdict controls; file-level hunks (binary, rename, mode) take a verdict but no comment; the commit-filter view has no bar.
- **File verdict.** The file header shows "a/n accepted" ("· r rejected" when any) and **Accept file**: disabled when nothing is pending or the review is closed, replaced by "All accepted" once every hunk is accepted, absent on uncommitted reviews and in the commit-filter view. Optimistic like per-hunk verdicts.
- **Selecting lines.** A selection covers one side's numbers only and stops at collapsed context or a collapsed hunk; expanding the gap lets it span two hunks. In split the left column selects the old side and the right column the new side; keyboard behaviour is the same in both views. No selection on binary or too-large files, closed reviews or the commit-filter view.
  - **Mouse/pen:** drag over one side's gutter, shift+click to extend, a plain click restarts. Releasing a press on a gutter (drag, click or shift+click) opens the comment composer for that range, Message focused. Selecting code text never opens it, nor does a press the browser cancels.
  - **Touch:** tap a line, tap another to extend, tap an endpoint to clear.
  - **Keyboard:** the diff is one tab stop; arrows move, ←/→ switch side, Shift+↑/↓ extend, Space/Enter select, `c` comments, Esc clears.
  - **Toolbar:** touch and keyboard selections (and a cancelled mouse press) show a toolbar under the selection ("L10–L14 (new)", Comment / Clear) instead of the composer.
- **Threads.** Shown under their end line (in split, full width under the row holding it); several stack in id order, old side first. Each card has kind and severity badges, status, disposition, a "re-anchored by context" chip for drifted anchors, a "proposes resolution" chip and banner, author badges ("You", or the role plus the session title), a reply box and resolve controls (a finding resolves "as fixed" or "as dismissed"). Reply and the resolve/reopen controls form one right-aligned action row, Reply last. Outdated threads are listed only in the panel's Outdated tab, labelled with their old lines and round, with a reply box and no status controls; their `file:line` link and Focus open comparison `R..R+1` (R = the last round the thread was located in) at their old lines, where the thread sits in place (a base-side thread opens round view R instead). Focus on a thread in another file opens that file at the thread.
- **Thread panel tabs.** This file; All (open/resolved filter, "Next unread"); Outdated; Dropped (uncommitted only). The All list is rebuilt whenever the review reloads (an SSE event, a write or the uncommitted poll), whether or not a file is open.
- **Message text.** Rendered as a markdown subset, the same in the thread panel and inline in the diff:
  - **Supported:** paragraphs, ATX headings (`#`–`######`, all shown at body size), `*em*`/`_em_`, `**strong**`, `~~del~~`, inline code, fenced code blocks (scroll sideways inside the card), bullet and numbered lists (nesting, start number), blockquotes, pipe tables with alignment, `---` rules, `[label](url)` and `<scheme:…>` links.
  - **Line breaks:** a single newline inside a paragraph is a line break (GitHub-comment style).
  - **Citations:** `path#L10-L20` becomes an in-app link that opens the file with the lines highlighted (a cited file outside the diff opens a read-only excerpt), in text, inside inline code, and as `[label](path#L10-L20)`. A citation is one token: `_`/`*` inside it are never emphasis. Not linked inside fenced blocks.
  - **External links:** `http(s)` and `mailto` links, and bare `http(s)` URLs, open in a new tab. A bare URL ends at whitespace, `<`, `>`, `"`, a backtick, `[`, `]`, or a `)` it did not open; trailing punctuation is not part of it. Any other target (relative, `#…`, `//host`, `javascript:`, `data:`…) shows its label as text.
  - **Shown as text:** raw HTML (including `<!-- … -->`). Images show as a link labelled by their alt text; nothing loads.
  - **Unsupported:** indented code blocks, setext headings, reference links, GFM task lists (`- [ ] x` shows a literal `[ ]`).
- **Commit filter.** Range reviews: choose one commit of the round to see its diff, read-only. Hidden in a past-round view and a comparison.
- **Round picker.** Range reviews with more than one round: "Round n (current)", then each past round (newest first, with its head's short sha). Picking a past round (`round=` in the URL) closes the open file and the commit filter and shows that round read-only (see [Past rounds](#rounds-and-refresh)):
  - a banner "Viewing round k of n — read-only…" with **Back to current round**; the file header shows a "round k · read-only" badge;
  - no verdict bar, no Accept file, no line selection, no composer, no reply box, no resolve controls; context expansion and cited excerpts read that round;
  - no review-level writes either: no Submit round or Re-send, no Refresh, no Reopen, no recipient picker (the recipient is shown as text), and the actions menu holds only Open agent (absent without a bridge and a recipient). The commit-filter view keeps them;
  - thread cards say how many later replies are hidden;
  - a refused round view shows the refusal in place of the file tree, with the picker still there.
  - `round=` naming the current round (or a later one) is dropped from the URL.
- **Compare rounds** (button beside the round picker) opens a comparison of the previous and the current round (`compare=A..B`; see [Comparing rounds](#rounds-and-refresh)), closing the open file, the round view and the commit filter:
  - **From** and **To** selects replace the round picker ("Round k · sha", the current round marked "(current)"); From lists rounds before To, To rounds after From; changing either closes the open file;
  - a banner "Comparing round A with round B — read-only…" with **Exit comparison**; the file header shows a "round A → B · read-only" badge;
  - read-only exactly like a past round (no verdicts, selection, composer, replies, resolve controls or review-level writes); still live: the file tree, file navigation, the split/inline toggle, resolved-thread collapse, context expansion (read from round B's head, round A's for a file deleted in the comparison), Focus and thread links, cited excerpts (`side=old` reads round A's head, `new` round B's). Focus marks nothing read;
  - thread panel tabs: This file (each thread once), All (every compared thread once, placed or not, with its note; the badge counts them), Not in diff (with the reason); no Outdated tab. Until the comparison loads every tab shows a loading state; a comparison that failed to load shows its error with Retry in every tab, and in the file pane (a failed reload keeps the loaded lists);
  - a citation link in a message leaves the comparison for the round view of the round that message was written in (`round=<its round>`), since that is the code it cites; outside comparisons citation links keep the current view;
  - no entry point with one round or on commit/uncommitted reviews.
- **Rounds.** A range review whose HEAD moved shows "HEAD moved — Refresh available"; uncommitted reviews have a Refresh button; commit reviews have none. A refresh reports hunks kept/reset/new and threads moved/drifted/outdated/dropped, or "No changes; still round n".
- **Closed and gone.** A closed review disables every write and offers Reopen. A removed checkout shows a banner; an unreadable snapshot replaces the tree with the refusal text.
- **Live updates.** Review events refetch what is on screen; uncommitted reviews also refetch on window focus and every 15 s while the page is visible. Only verdicts (per hunk and Accept file) update before the server answers, and revert with a toast if refused.
- **Unread.** Badges come from the server. Focusing a thread (Focus button, `thread=` link, "Next unread") marks it read; "Mark all read" in the header actions menu clears the whole review, including the "new" badge.
- **Dropped threads.** An uncommitted thread whose lines changed is deleted by the backend. The UI keeps its last fetched copy for the current page session only, in the Dropped tab and as a one-line notice, labelled "dropped: its lines changed". A reload forgets them; replying to one is refused `THREAD_DROPPED`.
- **Submitting.** "Submit round" (range, commit) or "Request review" (uncommitted) composes the prompt. Embedded in cc, it is sent through the cc bridge: success is recorded and toasts "Sent to …"; a bridge failure is recorded with its code and shown with Retry (same submission), Open agent, Copy prompt and Mark as sent. If cc does not answer within the deadline nothing is recorded and the dialog warns that the prompt may already have arrived, so Retry could deliver it twice. A code the UI does not know is shown raw and not recorded. Standalone, the dialog shows the prompt with Copy and Mark as sent; Close leaves it pending. If the prompt was sent but recording its result fails (network error, 5xx), the dialog state resets and the review refetches, so the submission shows up as pending and the header offers "Re-send"; the failure is toasted. A submission left failed or pending is offered again as "Re-send" in the header. A failed one (the bridge reported an error) reads "Last submission failed (code)". A pending one reads "Last submission isn't recorded as delivered" and warns that it may already have reached the session, so re-sending could deliver it twice: its delivery is unknown after a reload, after a closed copy dialog, or when recording the result failed. With no recipient the recipient picker opens.
- **Session following.** Embedded, the checkout comes from the route, else cc's active session, else the last checkout used. Later session changes to a project the picker lists switch the checkout (replacing the history entry); a conductor session, or one in a project cc does not list, leaves the view alone. "Open agent" focuses the recipient session. Standalone, none of this runs.
