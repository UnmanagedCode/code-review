# Testing and harnesses

- `npm test` = `typecheck` + `node --test tests/*.test.js` + `vitest run` (happy-dom). The node glob is quoted in `package.json` so npm's shell does not expand it differently across platforms.
- Backend tests start `start({ port: 0, distDir })` against a temp dist; never rely on a real `frontend/dist` or a fixed port.
- **The mutation harness judges the backend: `server.js` and `src/`** (`runner: node-test`, one runner per harness). UI tests run under vitest and are outside it.
- Git tests build repos under `os.tmpdir()` (`tests/_git.js`), never inside the project tree; the fake cc (`tests/_fakeCc.js`) is wired by setting `CONDUCTOR_URL`; the store by `CODE_REVIEW_STORE` (`tests/_store.js`). `tests/_*.js` helpers are not matched by the test glob.
- Real cc and the real `$PROJECTS_ROOT/.code-review` are never touched by tests.
- `harness/playwright/snap.mjs` writes screenshots to `harness/playwright/out/` (gitignored). It tolerates exactly the two host-URL 404s.
- Mutation `baseline` needs a clean tree and `CC_PROJECTS_ROOT` exported.
