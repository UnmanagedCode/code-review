# Manifest gotchas

- **No `mcp` block yet.** cc's manifest validation (`validateMcp` in cc's `src/plugins/manifest.ts`) requires a non-empty `mcp.tools` array, so an empty one makes the plugin `invalid`. Add the block together with the first tool.
- **`healthPath` is `/health`**, served by `server.js` before anything else.
- **Default port 7400.** Siblings already use 7000 (hub), 7100 (kanban), 7200 (karpathy-wiki), 7300 (live), 7310 (playbook), 4310 (system). `$PORT` always wins when cc injects it.
- **`claudePlugin: "."`** makes the repo root the Claude Code plugin root; skills will live at `skills/<name>/SKILL.md`. A missing `.claude-plugin/plugin.json` is only warned about at launch, not at manifest load.
