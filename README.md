# code-review

A [code-conductor](https://github.com/UnmanagedCode/code-conductor) (cc) plugin for reviewing a checkout's diff.

> **Status: in progress.** Only the compliant plugin skeleton exists: manifest, backend, themed placeholder UI, tests and harnesses. The features below are planned.

## What it will do

- The human reviews a checkout's diff in the plugin UI.
- The human holds threaded discussions with agents, anchored to selected code lines.
- Agents take part through the plugin's MCP tools and a Claude Code skill.

## Technical overview

- **Stack:** Node ≥ 24, Express 4 backend; React 19 + Vite + Tailwind v4 UI; shadcn/Radix components copied from cc on first use; lucide + sonner. Follows cc's `docs/plugin-ui.md` (host contract, security, reference setup).
- **Backend:** `server.js` binds `127.0.0.1` only, honours `$PORT` (default `7400`). Order: `/health`, `/api` (reserved), CSP header, static `frontend/dist`. No SPA fallback, so `/pluginBridge.js` and `/pluginTheme.css` 404 standalone.
- **Manifest:** `conductor.plugin.json` (id `code-review`, `pluginApi: 1`); `claudePlugin: "."` with `.claude-plugin/plugin.json` (no skills yet). No `mcp` block until the first tool exists (cc rejects an empty `tools` array).

```
conductor.plugin.json  server.js  package.json
.claude-plugin/plugin.json
frontend/              index.html, vite.config.ts, public/theme-init.js, src/{main,App}.tsx, src/lib/*
tests/                 node --test backend tests
harness/mutation/      code-mutant config (see its README)
harness/playwright/    snap.mjs screenshot harness
.wiki/                 durable project knowledge
```

### Run standalone

```bash
npm install            # installs deps and builds frontend/dist (prepare)
PORT=7400 npm start    # http://127.0.0.1:7400/
npm run dev            # Vite dev server, /api proxied to PLUGIN_BACKEND (default http://127.0.0.1:7400)
```

Standalone the page follows the OS light/dark scheme; the two host URLs 404 and log the only expected console errors.

### Test

```bash
npm test               # typecheck + node --test (backend) + vitest/happy-dom (UI)
export CC_PROJECTS_ROOT=/path/to/projects-root
node harness/playwright/snap.mjs   # screenshots to harness/playwright/out/ (gitignored)
```

### Install in cc

Add a Library catalog entry (drop-in JSON, see cc's `docs/plugins.md` → Plugin Library):

```json
{
  "id": "code-review",
  "name": "Code Review",
  "repo": "https://github.com/UnmanagedCode/code-review",
  "postClone": "npm install",
  "postPull": "npm install"
}
```

Then Settings → Plugins → Rescan, and enable.
