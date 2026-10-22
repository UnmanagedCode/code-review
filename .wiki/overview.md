# Overview

**code-review** is a code-conductor (cc) plugin: the human reviews a checkout's diff in a plugin UI and holds threaded discussions with agents, anchored to selected lines. Agents join through the plugin's MCP tools and a Claude Code skill. The backend (git, store, REST, MCP, skill, conductor convention) and the review UI are built.

## Layout

- `conductor.plugin.json` — cc manifest. `.claude-plugin/plugin.json` — Claude Code plugin root (`claudePlugin: "."`).
- `server.js` — Express backend, also serves `frontend/dist`; mounts the API from `src/`.
- `src/` — backend modules; `docs/` — features, protocol, architecture; `skills/` and `conventions/` — agent prompt surfaces.
- `frontend/` — React + Vite + Tailwind v4 UI (cc's reference setup).
- `tests/` — `node --test` backend tests; UI tests sit beside their sources as `*.test.ts(x)`.
- `harness/mutation/`, `harness/playwright/`, `harness/bench/` — project-local verification harnesses and the `open_review` benchmark.

## Glossary

- **cc** — code-conductor, the host that proxies the plugin at `/plugins/code-review/`.
- **host URLs** — `/pluginBridge.js` and `/pluginTheme.css`, served by cc, 404 standalone.
- **bridge** — `/pluginBridge.js`: syncs cc's theme onto `<html>`, demotes `pushState`, reports routes.
- **standalone** — running `PORT=<p> npm start` outside cc.
- **review** — a stored discussion about one checkout's diff; **target** — what it covers (`range`, `commit`, `uncommitted`).
- **round** — one snapshot epoch of a review; refresh adds one.
- **hunk id** — hash of path + a hunk's +/- lines; the verdict key.
- **anchor** — a thread's lines plus context, re-located on refresh; **linesHash** — whitespace-normalised hash of them.
- **thread / finding / disposition** — a discussion on lines; a `finding` carries a severity and is closed with a disposition (`fixed`/`dismissed`) by the human, the conductor or its opening agent.
- **submission** — the prompt composed from the human's activity and sent to the recipient session.
- **mergeBlockers** — rejected hunks + open question threads; what the conductor holds a merge on.
