# Testing and harnesses

- `npm test` = `typecheck` + `node --test tests/*.test.js` + `vitest run` (happy-dom). The node glob is quoted in `package.json` so npm's shell does not expand it differently across platforms.
- Backend tests start `start({ port: 0, distDir })` against a temp dist; never rely on a real `frontend/dist` or a fixed port.
- **The mutation harness judges the backend: `server.js` and `src/`** (`runner: node-test`, one runner per harness). UI tests run under vitest and are outside it.
- Git tests build repos under `os.tmpdir()` (`tests/_git.js`), never inside the project tree; the fake cc (`tests/_fakeCc.js`) is wired by setting `CONDUCTOR_URL`; the store by `CODE_REVIEW_STORE` (`tests/_store.js`). `tests/_*.js` helpers are not matched by the test glob.
- **Every git call needs a fake cc**, since git runs through its `POST /api/exec`: a test that calls `git.js`/`snapshot.js` directly starts one per file (`before`/`after`) and passes `localPlace(dir)`.
- **Remote systems are faked with a virtual root** (`/cr-remote-<hex>`, `world({system, remoteId})`): the fake rewrites argv/cwd/env under it to the real temp dir. The root must not exist on this machine, so a leftover host-local `fs` or `execFile` on a remote path fails instead of silently reading the real dir. Count calls with `state.execCalls`, inject refusals with `state.execHook`, pin `TMPDIR` with `state.execEnv`.
- **The fake cc's `displayLabel` is a stand-in** (`title || firstPrompt || <id prefix>…`), not cc's rule: a test that asserts a label sets `displayLabel` on its row. `state.displayLabel = false` sends rows without the field (a cc that lacks it). `world().session()` takes `title` and `firstPrompt` to seed an untitled session.
- `harness/bench/open-review.mjs` times `openReview` for any checkout's `src/` (`--tree`) against this tree's fake cc; not a test.
- Each temp repo sits in its own `mkdtemp` dir (`tests/_git.js`) that also holds its worktrees and fixtures; cleanup removes exactly that path, never a name pattern.
- Real cc and the real `$PROJECTS_ROOT/.code-review` are never touched by tests.
- `harness/playwright/snap.mjs` and `golden.mjs` write screenshots to `harness/playwright/out/` (gitignored). They tolerate exactly the two host-URL 404s, plus 502s during `snap.mjs`'s system-down step (`seed().systemDown(true)` makes the fake cc refuse every exec).
- Mutation `baseline` needs a clean tree and `CC_PROJECTS_ROOT` exported.
- UI tests: vitest + happy-dom with shared fakes in `frontend/src/test/` (fetch route table, EventSource, `ccBridge`, fixtures); see [ui.md](ui.md).
- **Scope harness waits to the pane you shot.** The diff's inline thread cards are `article`s too, so a bare `getByRole('article')` resolves before the Threads tab's list has loaded; `snap.mjs` waits inside the `tabpanel`.
- `harness/playwright/seed.mjs` seeds one world through the REST/MCP API using `tests/_world.js`; `snap.mjs` and `golden.mjs` use it. Run `npm run prepare` first so `frontend/dist` is current.
