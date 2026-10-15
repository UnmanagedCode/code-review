# Overview

**code-review** is a code-conductor (cc) plugin: the human reviews a checkout's diff in a plugin UI and holds threaded discussions with agents, anchored to selected lines. Agents join through the plugin's MCP tools and a Claude Code skill. Only the compliant skeleton exists; the diff UI, threads, API and MCP tools are not built yet.

## Layout

- `conductor.plugin.json` — cc manifest. `.claude-plugin/plugin.json` — Claude Code plugin root (`claudePlugin: "."`).
- `server.js` — Express backend, also serves `frontend/dist`.
- `frontend/` — React + Vite + Tailwind v4 UI (cc's reference setup).
- `tests/` — `node --test` backend tests; UI tests sit beside their sources as `*.test.ts(x)`.
- `harness/mutation/`, `harness/playwright/` — project-local verification harnesses.

## Glossary

- **cc** — code-conductor, the host that proxies the plugin at `/plugins/code-review/`.
- **host URLs** — `/pluginBridge.js` and `/pluginTheme.css`, served by cc, 404 standalone.
- **bridge** — `/pluginBridge.js`: syncs cc's theme onto `<html>`, demotes `pushState`, reports routes.
- **standalone** — running `PORT=<p> npm start` outside cc.
