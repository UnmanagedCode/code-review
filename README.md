# code-review

A [code-conductor](https://github.com/UnmanagedCode/code-conductor) (cc) plugin for reviewing a checkout's diff.

> **Status: in progress.** The backend (review model, git, store, REST API, MCP tools, skill, conductor convention) is built. The review UI is still the themed placeholder.

## What it will do

- The human reviews a checkout's diff in the plugin UI.
- The human holds threaded discussions with agents, anchored to selected code lines.
- Agents take part through the plugin's MCP tools and a Claude Code skill.

Docs: [features](docs/features.md) · [protocol](docs/protocol.md) · [architecture](docs/architecture.md).

- **Review API:** REST + SSE under `/api` ([protocol](docs/protocol.md)).
- **MCP tools:** `open_review`, `get_review`, `list_threads`, `get_hunk`, `annotate`, `reply`, `refresh_review`.
- **Skill:** `review-dialog` (`skills/review-dialog/SKILL.md`).
- **Conductor convention:** opt-in `review-in-code-review` (`conventions/conductor-review.md`).

## Technical overview

- **Stack:** Node ≥ 24, Express 4 backend; React 19 + Vite + Tailwind v4 UI; shadcn/Radix components copied from cc on first use; lucide + sonner. Follows cc's `docs/plugin-ui.md` (host contract, security, reference setup).
- **Backend:** `server.js` binds `127.0.0.1` only, honours `$PORT` (default `7400`). Order: `/health`, `/api` (reserved), CSP header, static `frontend/dist`. No SPA fallback, so `/pluginBridge.js` and `/pluginTheme.css` 404 standalone.
- **Manifest:** `conductor.plugin.json` (id `code-review`, `pluginApi: 1`); `claudePlugin: "."` with `.claude-plugin/plugin.json` and `skills/`; an `mcp` block and one conductor-scope convention.

```
conductor.plugin.json  server.js  package.json
.claude-plugin/plugin.json
src/                   backend modules (see docs/architecture.md)
skills/                review-dialog skill
conventions/           conductor convention
docs/                  features, protocol, architecture
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

The review store is `$CODE_REVIEW_STORE`, else `$PROJECTS_ROOT/.code-review`; without either the API answers 503 `STORE_UNCONFIGURED` and the page still loads. Standalone the page follows the OS light/dark scheme; the two host URLs 404 and log the only expected console errors.

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

## Known limitations

- `caller` in the MCP envelope is unauthenticated loopback input: any local process can pose as any agent (see [protocol](docs/protocol.md#mcp)). The REST surface already acts as the human.
- Local projects only; remote (`system`) projects are refused.
- The commit-filter view of a range review is read-only.
- Uncommitted edits are not pushed: the UI re-fetches on focus or an interval.
- A branch `base` follows its branch at each refresh; a sha base is fixed.
- Renaming a file resets the verdicts of its hunks.
