# code-review

A [code-conductor](https://github.com/UnmanagedCode/code-conductor) (cc) plugin for reviewing a checkout's diff.

## What it does

- The human reviews a checkout's diff in the plugin UI, hunk by hunk, with accept/reject verdicts.
- The human holds threaded discussions with agents, anchored to selected code lines.
- Agents take part through the plugin's MCP tools and a Claude Code skill.
- The human submits each round to the recipient session through cc's bridge.

Docs: [features](docs/features.md) · [protocol](docs/protocol.md) · [architecture](docs/architecture.md).

- **Review UI:** [features](docs/features.md#review-ui).
- **Review API:** REST + SSE under `/api` ([protocol](docs/protocol.md)).
- **MCP tools:** `open_review`, `get_review`, `list_threads`, `get_hunk`, `annotate`, `reply`, `refresh_review`.
- **Skill:** `review-dialog` (`skills/review-dialog/SKILL.md`).
- **Conductor convention:** opt-in `review-in-code-review` (`conventions/conductor-review.md`).

## Technical overview

- **Stack:** Node ≥ 24, Express 4 backend; React 19 + Vite + Tailwind v4 UI; shadcn/Radix components copied from cc on first use; lucide + sonner; prismjs (syntax highlighting, a lazily loaded chunk). Follows cc's `docs/plugin-ui.md` (host contract, security, reference setup).
- **Backend:** `server.js` binds `127.0.0.1` only, honours `$PORT` (default `7400`). Order: `/health`, `/api` (reserved), CSP header, static `frontend/dist`. No SPA fallback, so `/pluginBridge.js` and `/pluginTheme.css` 404 standalone.
- **Manifest:** `conductor.plugin.json` (id `code-review`, `pluginApi: 1`); `claudePlugin: "."` with `.claude-plugin/plugin.json` and `skills/`; an `mcp` block and one conductor-scope convention.

```
conductor.plugin.json  server.js  package.json
.claude-plugin/plugin.json
src/                   backend modules (see docs/architecture.md)
skills/                review-dialog skill
conventions/           conductor convention
docs/                  features, protocol, architecture
frontend/              index.html, vite.config.ts, public/theme-init.js, src/{lib,state,features,components,test}
tests/                 node --test backend tests
harness/mutation/      code-mutant config (see its README)
harness/playwright/    seed.mjs, snap.mjs (screenshots), golden.mjs (interaction)
harness/bench/         open-review.mjs (openReview timing), requests.mjs (per-request round trips), highlight.mjs (worst-case highlighting per language); see its README
.wiki/                 durable project knowledge
```

### Run standalone

```bash
npm install            # installs deps and builds frontend/dist (prepare)
PORT=7400 npm start    # http://127.0.0.1:7400/
npm run dev            # Vite dev server, /api proxied to PLUGIN_BACKEND (default http://127.0.0.1:7400)
```

The review store is `$CODE_REVIEW_STORE`, else `$PROJECTS_ROOT/.code-review`; without either the API answers 503 `STORE_UNCONFIGURED` and the page still loads. Standalone the page follows the OS light/dark scheme; the two host URLs 404 and log the only expected console errors.

### Diagnostics

The cc connection log is `<store>/logs/cc.log`; what it records and the retry rules are in [docs/protocol.md](docs/protocol.md#cc-routes-consumed).

### Test

```bash
npm test               # typecheck + node --test (backend) + vitest/happy-dom (UI)
export CC_PROJECTS_ROOT=/path/to/projects-root
node harness/playwright/snap.mjs    # screenshots to harness/playwright/out/ (gitignored)
node harness/playwright/golden.mjs  # golden-path interactions, one screenshot per step
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
- Every checkout, local or on a System, is read through cc's `POST /api/exec` and located through `GET /api/projects/:name/location`: **code-review needs a code-conductor that serves both** (an older cc answers `CONDUCTOR_UNAVAILABLE`).
- Round comparisons are read-only. They diff the two rounds' heads, limited to files either round reviews, so when the base moved between the rounds those files also show the upstream changes. Base-side threads are listed (Not in diff), not placed.
- Each System that holds a reviewed project needs `git` ≥ 2.17 (`status --porcelain=v2 --no-ahead-behind`), a POSIX `sh`, `mkdir`, `cp`, `touch -r`, `rm`, `ls`, `awk`, `wc`, `realpath`, `readlink` and `cat`, and a `TMPDIR` (default `/tmp`) that is absolute and outside the project's tree.
- The commit-filter view of a range review is read-only.
- Past-round views are read-only; open/resolved there is the thread's current status (unless it went outdated later), and they show no verdicts.
- Uncommitted edits are not pushed: the UI re-fetches on focus or an interval.
- A branch `base` follows its branch at each refresh; a sha base is fixed.
- Renaming a file resets the verdicts of its hunks.
- Highlighting sees only the lines shown, so a construct opened in collapsed context (a block comment, a template string) may be mis-coloured.
- A diff side larger than its language's cap (`HIGHLIGHT_MAX_SIDE_CHARS_BY_LANG` in `frontend/src/lib/highlight/index.ts`) renders without syntax colours, so a large new or rewritten file can show plain; word emphasis still applies. The caps bound Prism's worst case (quadratic on some inputs); `harness/bench/highlight.mjs` re-measures them. In a very large rewrite, word emphasis stops partway down the file (a per-file work budget).
- Ignore whitespace and Context lines are display-only over git's 3-line hunks: fewer context lines never split a hunk, more never merge two, and files whose only change is whitespace stay listed.
- Split view needs a diff pane at least 36rem wide (phones always get the unified view).
- One file renders at a time; there is no all-files scroll.
- Dropped uncommitted threads are shown only for the current page session (the backend keeps their ids, not their text).
- After "Open in code-git", closing code-git's view (Escape or close) goes to the session, not back to the review; the browser's Back returns to it.
- The inbox marks a checkout gone only when cc no longer knows its project or lists its worktree, and never marks a down System (it runs no git); opening the review shows both. cc's answers are reused for `CODE_REVIEW_LOOKUP_TTL_MS` (default `DEFAULT_LOOKUP_TTL_MS` in `src/lookups.js`), so a checkout deleted within that time still shows.
