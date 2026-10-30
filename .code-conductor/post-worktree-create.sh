#!/usr/bin/env bash
# Symlink the main checkout's .wiki into a new worktree.
#
# .wiki/ is excluded from git (.git/info/exclude), so a fresh worktree has no
# wiki of its own. Linking to the main checkout's copy keeps every worktree
# reading and writing the same wiki files.
#
# Run by code-conductor after creating a worktree, with cwd in the new
# worktree. CC_WORKTREE_PATH and CC_PARENT_PATH are exported by the caller
# (the orchestrator, see code-conductor src/worktrees.ts).
#
# Never fails the worktree create: every outcome exits 0.

set -uo pipefail

worktree="${CC_WORKTREE_PATH:-$PWD}"

if [ -z "${CC_PARENT_PATH:-}" ] || [ ! -d "$CC_PARENT_PATH" ]; then
  echo "CC_PARENT_PATH is empty or not a directory, skipping .wiki symlink"
  exit 0
fi

if [ ! -d "$CC_PARENT_PATH/.wiki" ]; then
  echo "no .wiki in $CC_PARENT_PATH, skipping .wiki symlink"
  exit 0
fi

if [ -e "$worktree/.wiki" ] || [ -L "$worktree/.wiki" ]; then
  echo ".wiki already present in worktree, skipping"
  exit 0
fi

parent_abs="$(cd "$CC_PARENT_PATH" && pwd)"
if ln -s "$parent_abs/.wiki" "$worktree/.wiki"; then
  echo "symlinked $worktree/.wiki -> $parent_abs/.wiki"
else
  echo "WARNING: could not symlink $worktree/.wiki; continuing without it" >&2
fi
exit 0
