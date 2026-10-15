# Testing and harnesses

- `npm test` = `typecheck` + `node --test tests/*.test.js` + `vitest run` (happy-dom). The node glob is quoted in `package.json` so npm's shell does not expand it differently across platforms.
- Backend tests start `start({ port: 0, distDir })` against a temp dist; never rely on a real `frontend/dist` or a fixed port.
- **The mutation harness judges the backend only** (`runner: node-test`, one runner per harness). UI tests run under vitest and are outside it.
- `harness/playwright/snap.mjs` writes screenshots to `harness/playwright/out/` (gitignored). It tolerates exactly the two host-URL 404s.
- Mutation `baseline` needs a clean tree and `CC_PROJECTS_ROOT` exported.
