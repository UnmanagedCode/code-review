# Mutation harness

Config for the shared `code-mutant` runner, so a prover can run `/code-mutant:prove` against this project.

A shell outside code-conductor must first export the absolute projects root:

```bash
export CC_PROJECTS_ROOT=/path/to/projects-root
```

## Configuration (`config.json`)

| Key | Value | Why |
|---|---|---|
| `baselineCommand` | `node --test tests/*.test.js` | the backend suite, run in-process |
| `testCommand` | `node --test {tests}` | `{tests}` is narrowed to the mutant's test files |
| `runner` | `node-test` | the command prints node:test counts |
| `isolation` | `copy` | in-process tests on ephemeral ports, no git inside the tree; `node_modules` is symlinked via `preserve` |
| `baseBranch` | `main` | the integration branch |

## Scope

- Judges **`server.js` only**. The UI tests run under vitest (`npm run test:ui`), a different runner, and are not covered; a harness takes one runner.
- Needs a clean worktree; commit before running.

## Commands

```bash
node "$CC_PROJECTS_ROOT/.plugins/code-mutant/mutate.mjs" baseline
node "$CC_PROJECTS_ROOT/.plugins/code-mutant/mutate.mjs" validate
node "$CC_PROJECTS_ROOT/.plugins/code-mutant/mutate.mjs" run --all
node "$CC_PROJECTS_ROOT/.plugins/code-mutant/mutate.mjs" candidates
```

`run` needs a catalog at `.mutation/mutants.json` (gitignored, authored per review); see `mutants.schema.md` in the runner's directory.

## Verified

`baseline` (no `--no-canary`) on the initial skeleton printed: baseline `PASSED 6/0/0 (p/f/s)`, canary `KILLED [counted grade, baseline scope] via tests/server.test.js`, exit 0.
