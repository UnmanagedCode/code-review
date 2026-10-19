# Testing and harnesses

- `npm test` = `typecheck` + `node --test tests/*.test.js` + `vitest run` (happy-dom). The node glob is quoted in `package.json` so npm's shell does not expand it differently across platforms.
- Backend tests start `start({ port: 0, distDir })` against a temp dist; never rely on a real `frontend/dist` or a fixed port.
- **The mutation harness judges the backend: `server.js` and `src/`** (`runner: node-test`, one runner per harness). UI tests run under vitest and are outside it.
- Git tests build repos under `os.tmpdir()` (`tests/_git.js`), never inside the project tree; the fake cc (`tests/_fakeCc.js`) is wired by setting `CONDUCTOR_URL`; the store by `CODE_REVIEW_STORE` (`tests/_store.js`). `tests/_*.js` helpers are not matched by the test glob.
- Each temp repo sits in its own `mkdtemp` dir (`tests/_git.js`) that also holds its worktrees and fixtures; cleanup removes exactly that path, never a name pattern.
- Real cc and the real `$PROJECTS_ROOT/.code-review` are never touched by tests.
- `harness/playwright/snap.mjs` and `golden.mjs` write screenshots to `harness/playwright/out/` (gitignored). They tolerate exactly the two host-URL 404s.
- Mutation `baseline` needs a clean tree and `CC_PROJECTS_ROOT` exported.
- UI tests: vitest + happy-dom with shared fakes in `frontend/src/test/` (fetch route table, EventSource, `ccBridge`, fixtures); see [ui.md](ui.md).
- **Scope harness waits to the pane you shot.** The diff's inline thread cards are `article`s too, so a bare `getByRole('article')` resolves before the thread panel has loaded; `snap.mjs` waits inside the `tabpanel`.
- `harness/playwright/seed.mjs` seeds one world through the REST/MCP API using `tests/_world.js`; `snap.mjs` and `golden.mjs` use it. Run `npm run prepare` first so `frontend/dist` is current.
