# Wiki index

- [overview.md](overview.md) — what the plugin is, layout, glossary.
- gotchas/
  - [host-contract.md](gotchas/host-contract.md) — relative URLs, host URLs that must 404, no SPA fallback, no own theme toggle, history.
  - [install-hook.md](gotchas/install-hook.md) — build-on-install via `prepare`; what must stay untracked.
  - [manifest.md](gotchas/manifest.md) — `mcp` block rules, conductor convention file, `claudePlugin`, port choice.
  - [testing-and-harnesses.md](gotchas/testing-and-harnesses.md) — two test runners, temp repos/fake cc and its exec, virtual roots for remote systems, the bench, what the mutation harness covers.
  - [git-plumbing.md](gotchas/git-plumbing.md) — everything over `/api/exec` (cwd `/`, argv, base64), index rewrites and the target-side private index (`touch -r`, two-call alternates), pinned flags, `--no-index`, quoted paths, base re-resolution.
  - [anchoring.md](gotchas/anchoring.md) — hunk ids, `linesHash`, locate modes, cross-hunk rule, `pastAnchors` and what is derived vs not.
  - [ui.md](gotchas/ui.md) — selection clamps, drag/composer, `pointercancel` disarm, resolve buttons in the reply form, SSE echo, optimistic verdicts, accept-file ids, active-verdict tint, bridge timeout, route precedence, `REVIEW_SCOPED` route resets, past-round view vs commit filter, review-list scroller and fixed footer, happy-dom limits.
  - [markdown.md](gotchas/markdown.md) — message-body markdown: citation/URL atoms, the server's citation list, link allowlist, `\n` → `br`, linearity, `MAX_NESTING`.
  - [cc-metadata.md](gotchas/cc-metadata.md) — the four cc routes used, the exec refusal mapping, old-cc 404, unreachable ≠ gone, liveness, conductor rule, no session role.
  - [recipient-and-roles.md](gotchas/recipient-and-roles.md) — agent opener = recipient, conductor `author`, `roleOf`/`recipientRole`, reuse.
- architecture/
  - [serving.md](architecture/serving.md) — `server.js` middleware order and exports.
  - [store.md](architecture/store.md) — review files, locking, `seq` (bad files skipped and logged).
