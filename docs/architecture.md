# Architecture

Backend internals. Behaviour: [features.md](features.md); wire formats: [protocol.md](protocol.md).

## Modules (`src/`)

Services return a plain object or a refusal `{ok:false, code, reason}`. Low-level helpers throw `Refusal`; `attempt()` converts it. REST routes and MCP tools call the same service functions; neither surface has logic of its own. `server.js` only mounts `apiRouter()` under `/api`.

| Module | Responsibility |
|---|---|
| `paths.js` | `storeRoot()`: `$CODE_REVIEW_STORE`, else `$PROJECTS_ROOT/.code-review`, else throws `STORE_UNCONFIGURED` (resolved per call, so the server boots without it) |
| `mutex.js` | `withLock(key, fn)`: per-key promise chain |
| `refusals.js` | `Refusal`, `refuse`, `attempt`, `HTTP_STATUS` (single source of codes) |
| `store.js` | one JSON file per review: `read`, atomic `write` (bumps `rev`), `list`, `remove`, `mutate`, and the `changes` emitter |
| `cc.js` | cc REST client (`projects`, `worktrees`, `instances`) |
| `checkouts.js` | resolve a checkout, fork-point chain, sessions, picker data |
| `git.js` | git wrapper: ref safety, pinned diff flags, plumbing calls, private index |
| `diff.js` | parse unified diff into files/hunks; hunk ids; file-level hunks (pure) |
| `snapshot.js` | `resolveTarget` (kind → `{headSha, baseSha}`) and `buildSnapshot` (`{files, fingerprint, lines(side, path)}`) |
| `anchor.js` | `linesHash`, `makeAnchor`, `locate`, `hunkFor` (pure) |
| `follow.js` | moves threads to where their lines now are (refresh and the uncommitted sweep) |
| `context.js` | per-request view of a review: `makeEnv`, `inReview` (locked write path), `viewReview` (read path), `authorFor` |
| `reviews.js` | open, list, get, patch, delete, verdict, refresh, diff, commits, file lines, hunks |
| `threads.js` | annotate, reply, thread status, mark read, list |
| `rollup.js` | counts, `mergeBlockers`, unread, `ReviewSummary`, thread/hunk views (pure) |
| `citations.js` | parse and resolve `path#L…` |
| `submissions.js`, `prompt.js` | compose and record submissions; render the prompt text (pure) |
| `render.js` | MCP text renderings (pure) |
| `mcp.js` | `handle(body)` and the `_toolNames()` test seam |
| `routes.js` | `apiRouter()`: REST, SSE, `POST /mcp` |

## Store

- Location: `<root>/reviews/<id>.json`, id `r-<10 hex>`; ids are validated before touching the filesystem. The root is outside every project tree, so it survives plugin updates.
- The `changes` emitter has no listener cap (one listener per open SSE client). Message bodies are capped at `MAX_BODY_CHARS`.
- Writes are atomic (tmp file in the same dir, then `rename`); every write bumps `rev` and emits `change`. `mutate(id, fn)` runs under `withLock(id)` and writes only if `fn` changed the review; creation runs under `withLock('create')`.
- `schema: 1` is written for a future migration to self-check; there is no migration yet.
- Review fields: `id, project, worktree, branch, kind, target, baseLabel, title, status, createdAt, createdBy, recipient, seenByHuman, rev, seq, humanSeq, nextThread, nextSubmission, rounds, verdicts, threads, droppedThreads, submissions`.
- `seq` is a review-wide counter bumped by every message, verdict and status change; `humanSeq` is the `seq` of the last human one. Unread counts and "since last delivery" compare `seq`s; logic never reads the wall clock (`at`/`createdAt` are display-only).
- A thread's `humanReadSeq` is the `seq` the human has read up to. A human status change takes its own `seq`; opening and agent resolves share the `seq` of their message (how the prompt tells them apart).

## Git

- Every call: `git -c core.fsmonitor=false -C <repo>` with `LC_ALL=C` and `GIT_OPTIONAL_LOCKS=0`; diff flags are pinned (`DIFF_FLAGS` in `git.js`) so user config cannot change the parsed shape.
- `git diff <commit>` rewrites `.git/index` even with `GIT_OPTIONAL_LOCKS=0`. Uncommitted diffs therefore run against a private copy of the index (`withPrivateIndex`: path from `rev-parse --git-path index`, unique temp copy per call, deleted in `finally`; a missing index is not copied). The plugin never writes a project tree.
- `core.fsmonitor=false` is passed on every call: with `core.fsmonitor=true` even `git status` starts a detached `fsmonitor--daemon` that creates `.git/fsmonitor--daemon*`.
- **Known limitation:** a clean/smudge filter driver named by the reviewed repo's own `.gitattributes` (e.g. git-lfs) still runs on working-tree paths, because a correct diff needs it.
- Uncommitted snapshots hold one entry per path. A path HEAD has but the index lacks (`git rm --cached`) is staged into the private index first, so it shows as working tree vs HEAD (nothing if unchanged) instead of deleted plus added.
- Refs (`base`, `sha`) must match `REF_RE` and not start with `-` (`BAD_REF`), then resolve via `rev-parse --verify --end-of-options` (`REF_UNKNOWN`).
- Targets resolve to two shas per round: range → `merge-base <base> HEAD` and HEAD; commit → first parent (or the empty tree) and the commit; uncommitted → HEAD (or the empty tree on an unborn branch) for both, new side read live. The empty tree comes from `hash-object -t tree --stdin`.
- Untracked files: `ls-files --others --exclude-standard -z`, each diffed with `diff --no-index` (exit 1 = success). Caps `MAX_UNTRACKED_FILES` and `MAX_FILE_BYTES` list the excess as `tooLarge`; `MAX_DIFF_BYTES` is the buffer limit (`DIFF_TOO_LARGE`).
- Committed snapshots are cached in memory by `(repo, baseSha, headSha, kind)`; uncommitted ones are always live.
- Repo used: the checkout when it exists; otherwise, for range/commit reviews, the project's main checkout (worktrees share the object store). A pinned sha missing from the store is `SNAPSHOT_GONE`.
- Working-tree reads are contained: `realpath(file)` must sit under `realpath(checkout)`.

## Hunk ids and anchors

- Hunk id: `sha256(path \0 changedLines \0 occurrence)`, first 12 hex; `changedLines` is the `+`/`-` lines with prefixes, `occurrence` the index among identical blocks in the file. Line numbers and context are excluded.
- File-level hunk id: hash of path, status, oldPath, blob ids and modes.
- `linesHash`: sha256 (first 16 hex) of the lines with trailing `[ \t\r]` stripped, indentation kept.
- Anchor: `round` (the snapshot its `lines`/`linesHash` were read from; `followThreads` sets it to the new round on every re-anchor), selected `lines`, `ctxBefore`/`ctxAfter` (hash and count of up to `CONTEXT_LINES` neighbours), `hunkId` from `hunkFor` (the hunk containing `endLine`, else the last one overlapped, else null), `drifted`.
- `locate(anchor, lines, mode)`: windows whose `linesHash` matches, ranked by context matches, then distance to the old start, then earliest. An exact match always reports `drifted: false`. Mode `reanchor` additionally accepts a unique `ctxBefore` followed by a unique `ctxAfter` with a gap of 1 to `2·len + 10` lines (`drifted`); mode `volatile` never does.

## Refresh and the uncommitted sweep

- Range refresh (under the review lock): re-resolve target; unchanged shas → no new round. Else build the new snapshot, keep verdicts whose hunk id survives, run `followThreads(…, 'reanchor')` with a rename map from `git diff -M --name-status <prevHead> <newHead>`, push the round.
- Uncommitted: `inReview` runs `followThreads(…, 'volatile')` before every read or write; unlocatable threads are deleted and remembered in `droppedThreads` (→ `THREAD_DROPPED`). The sweep is skipped when the checkout is unreadable. Refresh adds a round only when the snapshot `fingerprint` changed.

## Tests

`npm test` = typecheck, `node --test tests/*.test.js`, vitest. Backend tests use no network, sleeps or real cc:

- Mutating routes require a JSON content type (`routes.js` checks the header itself: `req.is` answers null for a body-less request).
- `tests/_git.js`: temp repos (`makeRepo`, `bindRepo` for worktrees) with pinned identity, dates and no signing.
- `tests/_fakeCc.js`: HTTP fake of the three cc routes on port 0, set via `CONDUCTOR_URL`; modes `ok|error|hang` (hang tests set `CODE_REVIEW_CC_TIMEOUT_MS` low).
- `tests/_store.js`: per-test `CODE_REVIEW_STORE` temp dir.
- `tests/_world.js`: project `app` + worktrees + fake cc + store in one call, with `HUMAN` and `agent()` actors.
- `tests/manifest.test.js` and `tests/surfaces.test.js` pin the manifest against the handlers, the flat-schema subset and the skill/convention tool names.
