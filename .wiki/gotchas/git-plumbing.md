# Git plumbing gotchas

- **`git diff <commit>` rewrites `.git/index`** (stat refresh) even with `GIT_OPTIONAL_LOCKS=0` or `--no-optional-locks`; `git status` and `ls-files` do not. Uncommitted diffs run with `GIT_INDEX_FILE` pointing at a private temp copy (`withPrivateIndex` in `src/git.js`). In a linked worktree the index lives under the common git dir's `worktrees/<name>/`, so its path always comes from `rev-parse --git-path index`, never from `<checkout>/.git/index`. A missing index is not copied (git starts empty). `tests/snapshot.test.js` asserts byte-identical indexes for main and linked checkouts.
- **Diff flags are pinned** (`DIFF_FLAGS`): user config for external diff, textconv, prefixes or relative paths would otherwise change the parsed shape.
- **`git diff --no-index` exits 1 when files differ**; `diffUntracked` treats 0 and 1 as success.
- **Paths can be C-quoted** (`"a\tb"`, octal-escaped UTF-8) in `diff --git`, `---`/`+++` and `rename` lines; `unquote` in `src/diff.js` decodes them. A binary file has no `---`/`+++`, so its path comes from the `diff --git` line.
- **A branch `base` is stored as given and re-resolved through `merge-base <base> HEAD` every round** (`...` semantics). After `sync_worktree` moves the base forward, the range still shows only the checkout's own work. A sha base stays fixed.
- **The empty tree** (root commits, unborn HEAD) comes from `hash-object -t tree --stdin`, so it is correct for the repo's hash format.
- **Refs are untrusted input:** `checkRef` rejects anything outside `REF_RE` or starting with `-`; resolution uses `--end-of-options`.
- **Worktrees share the object store**, so range/commit reviews of a deleted worktree stay readable via the main checkout; only a garbage-collected sha gives `SNAPSHOT_GONE`.
