# cc metadata gotchas

The plugin uses four cc routes through `CONDUCTOR_URL`: three GETs (`src/cc.js`) and `POST /api/exec` (`src/exec.js`) for every git command.

- `GET /api/projects` → `{name, path, system, remoteId}`. `system` absent means `local`; `remoteId` absent or `null` means the provider's default target (and is always `null` on `local`, where sending one is refused). `.conduct` is not listed.
- `GET /api/projects/:name/worktrees` → `{worktreeName, worktreePath, branch, baseBranch, baseSha, baseWorktree?}`. No `baseWorktree` means forked from the main checkout; the fork-point chain follows `baseWorktree` (cycle-guarded).
- `GET /api/instances` → `{sessionId, project, status, title, displayLabel?, conducted, worktree}`. Live = `status` not `exited`/`crashed`. The conductor is the session whose `project` is `.conduct`.
- **Session labels come from cc's `displayLabel` and are never re-derived here**: cc's rule (`sessionLabel`, with `readablePrompt`'s prompt parsers) gives `(new session)` for an untitled, unprompted session, so several sessions can share a label: the recipient selects suffix colliding labels with the id prefix (`sessionOptions` in `frontend/src/lib/sessionOptions.ts`). `sessions()` in `src/checkouts.js` is the only reader: without the field (an older cc) it falls back to `title`, then each UI site to the session id.
- **The `sessionIds` lists on other cc routes are not liveness-filtered**; never use them for liveness.
- **cc stores no session role.** Author/reviewer/conductor is derived per review (`roleOf` in `src/context.js`) and frozen on each message.
- Any failure or timeout of the GET routes is `CONDUCTOR_UNAVAILABLE`; their timeout is `CODE_REVIEW_CC_TIMEOUT_MS` (default 3000). Exec has its own, `CODE_REVIEW_GIT_TIMEOUT_MS`.
- **Exec refusals are mapped in one place** (`exec` in `src/exec.js`; table in `docs/protocol.md`): cc's resolution codes → `SYSTEM_UNREACHABLE`, `EXEC_TIMEOUT` → `GIT_TIMEOUT`, `EXEC_OUTPUT_TOO_LARGE` → `DIFF_TOO_LARGE`, `EXEC_SPAWN_FAILED` → `GIT_UNAVAILABLE`; anything else (`INVALID_ARGUMENT`…) is code-review's own bug and a 500.
- **A cc older than `/api/exec` answers 404 with no `code`**: mapped to `CONDUCTOR_UNAVAILABLE` naming the route, so "restart cc after updating it" is the visible fix. A 404 *with* a code is a real refusal.
- **`TEMP_UNUSABLE`** (a bad `TMPDIR` on the target) degrades like the unreachable codes on the snapshot path, but is not in `UNREACHABLE`: the existence probe and `statusOf` need no temp dir.
- **"Unreachable" is never "gone":** an `UNREACHABLE` code (`src/exec.js`) from the existence probe or a snapshot becomes `snapshotError`, with `checkoutGone: false`.
- The bridge's send-failure codes are stored verbatim on a submission (list in `docs/protocol.md`).
