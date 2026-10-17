# cc metadata gotchas

The plugin reads three cc routes through `CONDUCTOR_URL` (`src/cc.js`); no cc change was needed.

- `GET /api/projects` → `{name, path, system}`. `system` absent or `local` means local; `.conduct` is not listed.
- `GET /api/projects/:name/worktrees` → `{worktreeName, worktreePath, branch, baseBranch, baseSha, baseWorktree?}`. No `baseWorktree` means forked from the main checkout; the fork-point chain follows `baseWorktree` (cycle-guarded).
- `GET /api/instances` → `{sessionId, project, status, title, conducted, worktree}`. Live = `status` not `exited`/`crashed`. The conductor is the session whose `project` is `.conduct`.
- **The `sessionIds` lists on other cc routes are not liveness-filtered**; never use them for liveness.
- **cc stores no session role.** Author/reviewer/conductor is derived per review (`roleOf` in `src/context.js`) and frozen on each message.
- Any cc failure or timeout is `CONDUCTOR_UNAVAILABLE`; the timeout is `CODE_REVIEW_CC_TIMEOUT_MS` (default 3000).
- The bridge's send-failure codes are stored verbatim on a submission (list in `docs/protocol.md`).
