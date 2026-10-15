# Manifest gotchas

- **`mcp` block** (`endpoint: /api/mcp`): cc's manifest validation (`validateMcp` in cc's `src/plugins/manifest.ts`) requires a non-empty `mcp.tools` array, and tool schemas must stay flat (no nested `properties`, no `$ref`/`oneOf`/`anyOf`/`allOf`/`not`). `tests/manifest.test.js` mirrors those checks and pins the handler set to the manifest.
- **A conductor-scope convention whose `file` is missing makes the plugin `invalid`.** `tests/manifest.test.js` checks the file exists.
- **`healthPath` is `/health`**, served by `server.js` before anything else.
- **Default port 7400.** Siblings already use 7000 (hub), 7100 (kanban), 7200 (karpathy-wiki), 7300 (live), 7310 (playbook), 4310 (system). `$PORT` always wins when cc injects it.
- **`claudePlugin: "."`** makes the repo root the Claude Code plugin root; skills live at `skills/<name>/SKILL.md`. A missing `.claude-plugin/plugin.json` is only warned about at launch, not at manifest load.
