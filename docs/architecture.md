# Architecture

Backend internals. Behaviour: [features.md](features.md); wire formats: [protocol.md](protocol.md).

## Modules (`src/`)

Services return a plain object or a refusal `{ok:false, code, reason}`. Low-level helpers throw `Refusal`; `attempt()` converts it. REST routes and MCP tools call the same service functions; neither surface has logic of its own. `server.js` mounts `apiRouter()` under `/api`.

| Module | Responsibility |
|---|---|
| `paths.js` | `storeRoot()`: `$CODE_REVIEW_STORE`, else `$PROJECTS_ROOT/.code-review`, else throws `STORE_UNCONFIGURED` (resolved per call, so the server boots without it) |
| `mutex.js` | `withLock(key, fn)`: per-key promise chain |
| `refusals.js` | `Refusal`, `refuse`, `attempt`, `HTTP_STATUS` (single source of codes) |
| `store.js` | one JSON file per review: `read`, atomic `write` (bumps `rev`), `ids` (id-shaped file names only, nothing parsed), `list`, `remove`, `mutate`, `logSkipped`, and the `changes` emitter |
| `cc.js` | cc REST client (`projects`, `worktrees`, `instances`); `conductorUrl()` (the one `CONDUCTOR_URL` check) |
| `exec.js` | transport to cc's `POST /api/exec`: `exec(place, argv, opts)`, the cc → code-review refusal mapping, `UNREACHABLE` (the codes callers degrade on), `placeKey`. Knows nothing about git |
| `checkouts.js` | resolve a checkout to its place, fork-point chain, sessions, picker data |
| `git.js` | git over `exec.js`: ref safety, pinned diff flags, plumbing calls, the batched sh scripts, private index |
| `text.js` | `clean()`: strips control characters from header fields (prompt and MCP text); `oneLine`/`errorLine`: single-line log text; `stackFrames`: an error's frame lines without its message |
| `diff.js` | parse unified diff into files/hunks; hunk ids; file-level hunks (pure) |
| `snapshot.js` | `resolveTarget` (kind → `{headSha, baseSha}`) and `buildSnapshot` (`{files, fingerprint, lines(side, path)}`) |
| `anchor.js` | `linesHash`, `makeAnchor`, `anchorView` (positional fields), `locate`, `hunkFor` (pure) |
| `follow.js` | moves threads to where their lines now are (refresh and the uncommitted sweep), keeping each earlier round's anchor in `pastAnchors` (range reviews) |
| `history.js` | `threadsAt(review, n)`: threads as of round n (pure); `anchorChain`, `roundThreadView` |
| `rounds.js` | past-round views of range reviews: `pickRound`, `roundView`, `roundDiff` (`reviews.diff` delegates `?round=`) |
| `context.js` | per-request view of a review: `makeEnv`, `inReview` (locked write path), `viewReview` (read path), `roleOf`, `authorFor`, `recipientRole` |
| `reviews.js` | open, list, get, patch, delete, verdict, accept-file, refresh, diff, commits, file lines, hunks |
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
- `read(id)` throws `MisfiledReview` when the file's content has another `id` (or none): `write` persists under the content's id, so reading such a file as `id` would let any mutation copy it over another review, or create one. Nothing reads or writes through it.
- `list()` (the review list, `openReview`'s reuse check) skips and logs any file it cannot read, so one bad file hides only itself; opening that review by id still fails (500). Skip logs go through `logSkipped`: one line, the id cleaned and the error as `errorLine` (its name and message with whitespace collapsed and control characters removed; a parse error quotes the file's bytes). A route's unexpected error (500) logs the same single header line, `code-review: <METHOD> <url> failed: <Name>: <message>`, followed by the stack's frame lines only (`stackFrames`: the `    at …` lines after V8's `name: message` header, skipped by line count, so no message text follows the header).
- Writes are atomic (tmp file in the same dir, then `rename`); every write bumps `rev` and emits `change`. `mutate(id, fn)` runs under `withLock(id)` and writes only if `fn` changed the review; creation runs under `withLock('create')`.
- A review that cannot be read (unparsable JSON, `MisfiledReview`) is skipped and logged by `list()` (`code-review: review <id> skipped: <ErrorName>: <message>`) and still fails loudly when opened by id.
- Review fields: `id, project, worktree, branch, kind, target, baseLabel, title, status, createdAt, createdBy, recipient, author (session id; absent or `null` = none, so the recipient is the author), seenByHuman, rev, seq, humanSeq, nextThread, nextSubmission, rounds, verdicts, threads, droppedThreads, submissions`.
- `seq` is a review-wide counter bumped by every message, verdict and status change; `humanSeq` is the `seq` of the last human one. Unread counts and "since last delivery" compare `seq`s; logic never reads the wall clock (`at`/`createdAt` are display-only).
- Thread fields: `id, kind, severity, status, disposition, resolution:{by, seq}|null, resolveProposed, statusSeq, openedBy, anchor, pastAnchors, humanReadSeq, createdAt, messages`.
- A thread's `humanReadSeq` is the `seq` the human has read up to. A human status change takes its own `seq`; opening and agent resolves share the `seq` of their message (how the prompt tells them apart).

## Places and host exec

- **Place:** `{system, remoteId, path}`, the one value that addresses a checkout wherever a path used to be passed to git. `resolveCheckout` builds it from the `/api/projects` row (`system` absent = `local`; a worktree takes its project's `system` and `remoteId`) and returns `place` and `mainPlace` beside `path`/`mainPath` (those stay for messages and the picker). `placeKey(place)` keys caches: one path can exist on two systems.
- **Every checkout, local ones included, is read through `POST /api/exec`.** No module in `src/` spawns a process, and only `store.js` (code-review's own store) touches the filesystem; `tests/exec.test.js` guards both.
- **Request shape** (`exec` in `src/exec.js`): always form B with `cwd: "/"` (a vanished checkout is then git's or the script's answer, never an ambiguous spawn failure), always `argv` (no quoting, no login profile), always `encoding: "base64"` (decoded to Buffers; callers wanting text decode UTF-8 exactly as `execFile`/`readFileSync` did, so invalid UTF-8 comes out the same). `stdin` is sent as `stdinB64`; absent = closed stdin. `maxOutputBytes` is clamped to `EXEC_MAX_OUTPUT_BYTES`. The fetch deadline is `timeoutMs + min(10 s, timeoutMs)`, so cc reports `EXEC_TIMEOUT` first; aborting the fetch kills the command.
- **Refusal mapping:** the table in [protocol.md](protocol.md#cc-routes-consumed). `UNREACHABLE` (`src/exec.js`) is the single list the degradation paths read (`UNREADABLE` in `src/reviews.js` and `src/context.js`).
- **Existence:** `git.exists(place)` (`[ -e "$1" ]`, symlinks followed). A system that cannot answer refuses (`SYSTEM_UNREACHABLE`); it is never read as `exists: false`. `makeEnv` memoises the checkout (and so the probe) per request; the main-checkout fallback in `context.repo()` probes `mainPlace` only when the worktree is gone.
- **Degradation when a system is down:** `summaryOf` turns an `UNREACHABLE` refusal from the checkout, snapshot or `statusOf` (and `TEMP_UNUSABLE` from the snapshot) into `snapshotError` with `checkoutGone: false`, `dirty: false`, so the review list still lists every review; the uncommitted sweep skips (threads untouched). Open, refresh, the picker, `diff`, `fileLines` surface the refusal itself (502/504).

### Scripts (`src/git.js`)

Every script runs as `['sh', '-c', SCRIPT, 'sh', place.path, …args]`, starts with `cd -- "$1" || exit 3; shift` and calls git with the same `BASE_ARGS` as argv calls. Flags embedded in a script are single-quoted (`shq`).

| Constant | Does | Output |
|---|---|---|
| `CREATE_INDEX` | checks the temp base first: `${TMPDIR:-/tmp}` must be absolute, hold no line terminator (`\n`, `\r`; before and after resolving), exist, and resolve (`pwd -P`) outside the checkout and its common git dir, else exit 7 → `TEMP_UNUSABLE`. Then resolves `--git-path index`/`objects` (relative ones made absolute against `$PWD`), `mktemp -d "<base>/cr-index-XXXXXX"` (failure: exit 5 → `TEMP_UNUSABLE`), copies the index with `cp` + `touch -r` (a failing `mkdir`/`cp`/`touch`: exit 6 → `TEMP_UNUSABLE`) | `<dir>\0<objects>\0`; removes the dir itself on every failure after `mktemp`. `withPrivateIndex` then checks the printed dir structurally (`isTempDir`: absolute, no `..` segment, basename `cr-index-*`, any other byte allowed); a mismatch names no dir the script made and is `TEMP_UNUSABLE` |
| `WRITE_ALTERNATES` | writes `$2` (the C-quoted objects path, quoted in JS) to `$1/objects/info/alternates` | — |
| `OBJECTS_EXIST` | `cat-file -e "$s^{tree}"` per sha | the first missing sha, else nothing |
| `SIZES` | `ls -ldn` per path (lstat semantics: a symlink reports its own size) | one line per argument: the size, or `-` when absent; names are never echoed |
| `DIFF_UNTRACKED` | `diff <DIFF_FLAGS> --no-index -- /dev/null "$f"` per path; exit ≤ 1 is success | the concatenated diffs |
| `READ_FILE` | `realpath` (sentinel idiom, so a trailing newline in a name survives) must sit under `pwd -P` and be a regular file, then `cat` | the bytes; exit 3 → `null`; 126/127 (a missing tool) throws |

Plain argv calls: every git command (`run`: `git <BASE_ARGS> -C <path> …`), `exists`, and the teardown `rm -rf -- <dir>` (`removeTemp`, which refuses any path whose basename is not `cr-index-*`).

### Exec calls per operation

Counted by the fake cc (`execCalls`); locally each costs roughly an HTTP round trip plus JSON/base64, remotely the provider's latency on top. `harness/bench/open-review.mjs` measures wall time.

| Operation | Exec calls |
|---|---|
| `open_review` range on a worktree, cold snapshot cache | 9 |
| summary of one range review (list row) | 3 with its snapshot cached (`exists`, `OBJECTS_EXIST`, `statusOf`); 4 cold (plus the diff) |
| uncommitted snapshot, U untracked (U ≤ `MAX_UNTRACKED_FILES`, each within `MAX_FILE_BYTES`), no restage | 7 + ⌈U / `SIZE_CHUNK`⌉ + ⌈U / `UNTRACKED_CHUNK`⌉: `headOf`, `OBJECTS_EXIST`, `CREATE_INDEX`, `WRITE_ALTERNATES`, the tracked diff, `ls-files`, teardown, then `SIZES` and `DIFF_UNTRACKED` per chunk (U = 0 makes neither); `DIFF_UNTRACKED` chunks also close at a third of `maxDiffBytes` in summed size |
| picker `checkoutInfo` | 2: `exists`, `statusOf` |

## Git

- Every git call: `git -c core.fsmonitor=false -c core.splitIndex=false -C <path>` (`BASE_ARGS`) with the `BASE_ENV` overlay (`LC_ALL=C`, `GIT_OPTIONAL_LOCKS=0`) on the target's own environment, on scripts too; diff flags are pinned (`DIFF_FLAGS` in `git.js`) so user config cannot change the parsed shape. `statusOf` reads head, branch and dirty state from one `git status --porcelain=v2 -z --branch --no-ahead-behind`.
- `git diff <commit>` rewrites `.git/index` even with `GIT_OPTIONAL_LOCKS=0`. Uncommitted diffs therefore run against a private copy of the index (`withPrivateIndex`), made **on the checkout's system** in three exec calls: `CREATE_INDEX`, `WRITE_ALTERNATES` (a second call because the quoted entry depends on the first call's output), then the caller's commands with `GIT_INDEX_FILE` and `GIT_OBJECT_DIRECTORY` in the exec `env`; the dir is removed afterwards. The copy carries the original's exact times (`touch -r`), so git's racy-clean decisions on it are the original's own. A missing index is not copied. `GIT_OBJECT_DIRECTORY` is the private dir whose `info/alternates` file names the real objects dir, so anything staged writes its blobs to the private dir while HEAD's objects still resolve. The entry is C-quoted (git unquotes entries that start with `"`; control, `"`, `\` and non-ASCII bytes are escaped), so a newline, quote, backslash or leading `#` in the path cannot split or comment it out. The alternates file is used instead of `GIT_ALTERNATE_OBJECT_DIRECTORIES` because that variable is colon-separated and would split a checkout path containing `:`. A teardown that fails after the callback succeeded is a `console.warn` naming the leaked dir (it sits in the target's tmp, never in the tree), and the result is returned; if the callback threw, its error is rethrown. Git never writes the project's `.git` (index, objects, fsmonitor files); the only writes in a checkout are the reviewed repo's own filter drivers, if any (below).
- Temp files code-review causes on a target: `<TMPDIR>/cr-index-*` (its own, removed after each snapshot; a relative, missing, line-terminator-bearing, or in-checkout/in-git-dir `TMPDIR` is refused `TEMP_UNUSABLE` before anything is created) and cc's staged stdin `/tmp/cc-stdin-*` (for `update-index --stdin`; cc removes it before the command starts). Neither is under the checkout.
- `core.fsmonitor=false` is passed on every call: with `core.fsmonitor=true` even `git status` starts a detached `fsmonitor--daemon` that creates `.git/fsmonitor--daemon*`.
- `core.splitIndex=false` is passed on every call: with `core.splitIndex=true`, writing the private index (restaging, a diff's stat refresh) writes a new `sharedindex.<sha>` into the real git dir, because the copy links to the real shared index. Off, git still reads an existing split index and writes the private copy whole.
- **Git's own freshen-on-read (split index):** every git command that reads a split index bumps the mtime of the existing `sharedindex.<sha>` it links to, content unchanged; a plain `git status` in the repo does the same, and no config disables it (it keeps shared indexes from `splitIndex.sharedIndexExpire`). That mtime is the one stat a code-review read can change in `.git`: no shared index is created, removed or rewritten, and nothing else changes. The split-index variants of the byte-identity tests in `tests/remote.test.js` allow exactly that field.
- **Known limitation:** a clean/smudge filter driver named by the reviewed repo's own `.gitattributes` (e.g. git-lfs) still runs on working-tree paths, because a correct diff needs it.
- Uncommitted snapshots hold one entry per path. A path HEAD has but the index lacks (`git rm --cached`) is staged into the private index first, so it shows as working tree vs HEAD (nothing if unchanged) instead of deleted plus added. Restaged paths obey `MAX_FILE_BYTES` like untracked ones (over the cap: a `tooLarge` `modified` entry with a file-level hunk); a path that vanished before staging stays deleted. Existence and size come from one `SIZES` call per chunk (lstat semantics); the survivors are staged in one `update-index` call, and only if that fails (e.g. a required clean filter exits non-zero) are they staged one by one, where a path git cannot read becomes a `tooLarge` entry instead of failing the snapshot.
- Refs (`base`, `sha`) must match `REF_RE` and not start with `-` (`BAD_REF`), then resolve via `rev-parse --verify --end-of-options` (`REF_UNKNOWN`).
- Targets resolve to two shas per round: range → `merge-base <base> HEAD` and HEAD; commit → first parent (or the empty tree) and the commit; uncommitted → HEAD (or the empty tree on an unborn branch) for both, new side read live. The empty tree comes from `hash-object -t tree --stdin`.
- Untracked files: `ls-files --others --exclude-standard -z`; only the first `MAX_UNTRACKED_FILES` are measured (`SIZES`), the rest are `tooLarge` regardless. Those within `MAX_FILE_BYTES` are diffed by `diffUntrackedBatch`: one `DIFF_UNTRACKED` call per chunk of at most `UNTRACKED_CHUNK` paths and a third of the buffer limit in summed size, so a chunk's output stays under the per-call fence. `MAX_DIFF_BYTES` is the buffer limit (`DIFF_TOO_LARGE`) of every call.
- Committed snapshots are cached in memory by `(placeKey(repo), baseSha, headSha, kind)`; uncommitted ones are always live. Both shas are checked in one `OBJECTS_EXIST` call.
- Repo used: the checkout when it exists; otherwise, for range/commit reviews, the project's main checkout (worktrees share the object store). A pinned sha missing from the store is `SNAPSHOT_GONE`.
- Working-tree reads (`readWorktreeFile`, the uncommitted new side) are contained: `realpath(file)` must sit under the checkout's `pwd -P` and be a regular file. A file over `MAX_DIFF_BYTES` is `DIFF_TOO_LARGE`.

## Hunk ids and anchors

- Hunk id: `sha256(path \0 changedLines \0 occurrence)`, first 12 hex; `changedLines` is the `+`/`-` lines with prefixes, `occurrence` the index among identical blocks in the file. Line numbers and context are excluded.
- File-level hunk id: hash of path, status, oldPath, blob ids and modes.
- `linesHash`: sha256 (first 16 hex) of the lines with trailing `[ \t\r]` stripped, indentation kept.
- Anchor: `round` (the snapshot its `lines`/`linesHash` were read from; `followThreads` sets it to the new round on every re-anchor), selected `lines`, `ctxBefore`/`ctxAfter` (hash and count of up to `CONTEXT_LINES` neighbours), `hunkId` from `hunkFor` (the hunk containing `endLine`, else the last one overlapped, else null), `drifted`.
- `pastAnchors`: on range reviews, the thread's anchor in each round before `anchor.round` that it was re-anchored out of, oldest first, positional fields only (`anchorView`). `followThreads` appends the old anchor on every range refresh that relocates the thread. Uncommitted reviews never append (they have no past-round views); their threads keep `[]`. Outdated threads are never followed, so their last chain entry is the last round they were located in.
- Derived, not stored: a thread's creation round (`messages[0].round`); the round it went outdated (its last chain entry's round + 1); its status just before (`resolution` set → `resolved`, else `open`: going outdated changes only `status`).
- Not derivable: open/resolved as of an earlier round. Only the latest status change is stored (`statusSeq`, `resolution`), and rounds carry no `seq`, so past-round views show the current status (see the [protocol](protocol.md#shapes)).
- `locate(anchor, lines, mode)`: windows whose `linesHash` matches, ranked by context matches, then distance to the old start, then earliest. An exact match always reports `drifted: false`. Mode `reanchor` additionally accepts a unique `ctxBefore` followed by a unique `ctxAfter` with a gap of 1 to `2·len + 10` lines (`drifted`); mode `volatile` never does.

## Refresh and the uncommitted sweep

- Range refresh (under the review lock): re-resolve target; unchanged shas → no new round. Else build the new snapshot, keep verdicts whose hunk id survives, run `followThreads(…, 'reanchor')` with a rename map from `git diff -M --name-status <prevHead> <newHead>`, push the round.
- Uncommitted: `inReview` runs `followThreads(…, 'volatile')` before every read or write; unlocatable threads are deleted and remembered in `droppedThreads` (→ `THREAD_DROPPED`). The sweep is skipped when the checkout is unreadable. Refresh adds a round only when the snapshot `fingerprint` changed.

## Tests

`npm test` = typecheck, `node --test tests/*.test.js`, vitest. Backend tests use no network, sleeps or real cc:

- Binary detection: a file in the diff is binary when the snapshot says so (git honours `.gitattributes`, e.g. `*.bin -diff`); a NUL scan is the fallback only for files outside the diff. `isBinaryFile` in `snapshot.js` is the one predicate, used by line reads and citation excerpts (and matching `annotate`): in the diff → `binary || tooLarge`, decided without reading the file; outside it → NUL scan of the content, which it reads through a callback only then.
- Mutating routes require a JSON content type (`routes.js` checks the header itself: `req.is` answers null for a body-less request).
- `tests/_git.js`: temp repos (`makeRepo`, `bindRepo` for worktrees) with pinned identity, dates and no signing; `gitDirSig(dir)` (content hash, size and mtime of everything under `dir/.git`) proves a read path leaves git dirs untouched; `localPlace(dir)` for tests that call `git.js`/`snapshot.js` directly (they start a fake cc per file). Each repo lives in its own `mkdtemp` directory, which also holds its worktrees and fixtures; cleanup removes exactly that directory, never anything matched by name.
- `tests/_fakeCc.js`: HTTP fake of the cc routes on port 0, set via `CONDUCTOR_URL`; modes `ok|error|hang` (hang tests set `CODE_REVIEW_CC_TIMEOUT_MS` low). Its `POST /api/exec` validates as strictly as cc (unknown key, form, cwd, encoding, bounds) and runs the command for real: byte fence → `EXEC_OUTPUT_TOO_LARGE`, `timeoutMs` → `EXEC_TIMEOUT`, spawn error → `EXEC_SPAWN_FAILED`. `state.systems` maps a non-local system to a **virtual root** (`/cr-remote-<hex>`) backed by a real dir: argv elements, cwd and env values under the root are rewritten. The root must not exist on this machine, so any leftover host-local access to a remote path fails. `state.execCalls` records every body; `state.execHook(body)` may answer instead (`{status, body}`, `{status, raw}` or `'hang'`); `state.execEnv` overlays the command environment (tests pin `TMPDIR` to count private index dirs).
- `tests/_store.js`: per-test `CODE_REVIEW_STORE` temp dir.
- `tests/_world.js`: project `app` + worktrees + fake cc + store in one call, with `HUMAN` and `agent()` actors. `world({system, remoteId})` places the project on a fake system: cc rows carry virtual paths (`w.virtual(real)`), `repo.dir` stays real for setup.
- `tests/exec.test.js` (transport, mapping, byte-exactness, the no-`child_process`/no-`fs` guard), `tests/remote.test.js` (every surface on a project placed on a system, the system-down degradation, `.git` byte-identity over exec with and without `core.fsmonitor`).
- `harness/bench/open-review.mjs` (not in the test glob): `openReview` wall time and exec call counts on a large range diff and an uncommitted review with many untracked files; `--tree` points it at another checkout's `src/` for a before/after ([README](../harness/bench/README.md)).
- `tests/history.test.js` (pure `threadsAt`), `tests/rounds.test.js` (past-round views over real git; a round recorded by "another process" is pushed into the store so its snapshot is not cached and reading it runs git).
- `tests/manifest.test.js` and `tests/surfaces.test.js` pin the manifest against the handlers, the flat-schema subset and the skill/convention tool names.

## Frontend

`frontend/src/`; React 19, Vite, Tailwind v4, shadcn components copied from cc into `components/ui/`. Behaviour: [features.md](features.md#review-ui); routes: [protocol.md](protocol.md#ui-routes).

| Dir | Responsibility |
|---|---|
| `lib/` | `api.ts` (`ApiError {status, code, reason}`), `endpoints.ts` (the only place `api/…` paths are built), `types.ts` (wire shapes), `refusals.ts` (`messageFor` for backend codes, `bridgeMessage` for bridge codes), `route.ts`, `bridge.ts` (`window.ccBridge`, read per call), `sse.ts` (one shared EventSource), `storage.ts` (the only `localStorage` user, `code-review:` keys: `lastCheckout`, `diffView`, `threadPanelWidth`), `useMediaQuery.ts`, `useWidthObserver.ts` (ResizeObserver callback ref) |
| `lib/` (pure) | `markdown.ts` (body → AST; citations and URLs as atoms), `diffRows.ts` (rows, collapsible gaps, `collapseRows`), `splitRows.ts` (side-by-side pairing), `selection.ts` (selection model), `panelWidth.ts` (thread column bounds, `clampPanel`), `fileTree.ts` |
| `state/` | Hooks that fetch and write: `useFetch`, `live` (SSE reload, polling), `checkout`, `reviewList`, `review`, `round` (past-round view), `fileDiff`, `threads` (write actions), `threadIndex`, `submit` (delivery state machine), `admin`, `dropped`, `reviewContext` |
| `features/` | Components by area: `checkout`, `picker`, `reviews`, `review`, `files`, `diff`, `threads`, `submit`, `layout`, `common` |

- Components never call `fetch`; they use `state/` hooks and `lib/endpoints.ts`.
- **Refetch, never trust events.** An SSE event `{id, rev}` for the open review schedules a debounced refetch only if `rev` exceeds `knownRev`; every write response's review summary raises `knownRev`, so the echo of the UI's own write is ignored. An SSE reconnect refetches what is visible. The open file's diff refetches whenever the review reloads.
- **Uncommitted reviews** emit no events for working-tree edits: `usePolling` reloads on focus, `visibilitychange` and every `POLL_MS` while visible.
- **Diff rows.** `buildRows` produces hunk, line and gap rows from hunks plus per-gap expansion counts (`top`, `bottom`) and fetched line texts. The total line count (needed for the trailing gap) comes from a one-line `GET …/file`. Without a diff-wide list endpoint, the thread index fetches the diff of each file whose counts show threads.
- **Diff pipeline in `FileDiff`.** `rows` → `collapseRows` (accepted hunks reduced to a `collapsed` header; `useCollapse` owns which) → `visible`, which `useLineSelection`, the row limit and target widening all use → sliced to the limit → `splitRows` in split view. Both transforms are pure; split keeps each side's line order, so selection, keyboard and thread placement run on the flat visible rows in both views. `InlineRow` / `SplitRow` render line rows; `HunkHeader` the hunk row (normal, collapsible, collapsed); `SettledThread` every inline thread (summary disclosure when resolved); one `belowRow` closure renders notices, cards and the selection toolbar/composer under inline rows, split pairs and collapsed hunks.
- **Diff view.** `useDiffView` reads the stored choice and reports split as available in the wide layout while `FileDiff`'s root is at least `SPLIT_MIN_PX` wide (`useWidthObserver`; that element's width does not depend on the view).
- **Resizable thread column.** `DesktopLayout` (`features/layout/layouts.tsx`) sizes its right column from `useResizablePanel`: stored width clamped on render to the room (layout width minus the left column) by `clampPanel`; `ResizeHandle` is the `role="separator"`. Without a right column nothing is observed.
- **Past-round view.** `ReviewView` derives `round` from the route (range reviews, no `commit`, below the current round) and puts it in the review context with `readOnly: true`. `files`, `outdatedThreads` and `threadCounts` then come from `useRoundView`; `useFileDiff`, `useThreadIndex` and `CitedExcerpt` pass `round` to `diff`/`file`. Until the review loads, a `round=` URL holds the open file's fetch, since the live and past views cannot be told apart yet.
- **Selection.** `useLineSelection` drives a `role="grid"` with roving `tabIndex`; the selection model lives in `lib/selection.ts`.
- **Submission machine.** `state/submit.ts`: compose → bridge send within `SEND_DEADLINE_MS` → record result; states `idle`, `composing`, `sending`, `delivered`, `failed`, `timedOut`, `manual`.
- **Message bodies** render only through `features/threads/Markdown.tsx`: `parseMarkdown` (`lib/markdown.ts`) AST → React elements from a fixed tag map, no HTML strings, links only via `safeHref` or a citation in the message's server-parsed `citations`. Styles: the `.md` block in `index.css`.
- **Theme.** Colours only through tokens (`bg-success/10`, `text-muted-foreground`); a guard test bans literal colours and palette classes.

### UI tests

`npm run test:ui` (vitest, happy-dom). `src/test/` holds the shared fakes:

- `setup.ts`: cleanup, `vi.unstubAllGlobals()`, deletes `window.ccBridge`, clears storage and tombstones, resets the URL.
- `stubFetch.ts`: route table keyed `METHOD path` (or RegExp); an unstubbed request fails the test.
- `fakeEventSource.ts`: `emit`, `fail`, `reopen`; installed through `setEventSourceFactory`.
- `fakeBridge.ts`: `installBridge(session?)` with programmable `sendPrompt`/`openSession` and `emit`.
- `fixtures.ts`: wire-shaped builders. `renderCtx.tsx`: render under a `ReviewProvider` with spies.
- `fakeMedia.ts`: `installMedia({ [query]: matches })` stubs `matchMedia` for those queries (others fall through to happy-dom's 1024px window); `set(query, matches)` flips one and notifies.
- `fakeResizeObserver.ts`: `installResizeObserver()`; `resize(el | 'all', width)` delivers a width, `observed()` lists observed elements. Unstubbed, nothing is ever measured (width 0).
- happy-dom has no layout: geometry (drag across real rows, overflow, sticky headers) is checked by the Playwright harness.
- RTL's `waitFor` hangs under vitest fake timers; use `vi.waitFor` there.

### Visual harness

`harness/playwright/seed.mjs` builds one deterministic world (temp repo with a `feature` worktree, fake cc with two sessions, temp store, booted server) through the REST and MCP APIs, reusing the backend test helpers. `snap.mjs` screenshots each screen in light and dark at desktop and phone width; `golden.mjs` drives drag-select and comment, accept, submit without a bridge, picking round 1 and back, a stub bridge (session switch, failed then retried send), then split view (no horizontal overflow, remembered, right-gutter drag), collapsed accepted hunk and resolved thread in both views, phone fallback to inline, the xl thread column's handle (drag widens it and pushes split down to inline, End keeps the diff's minimum, width survives a reload) and no handle on the `md` sheet. `snap.mjs` adds `diff-split-collapsed` and `diff-split` shots at 1100px. Output goes to `harness/playwright/out/` (gitignored).
