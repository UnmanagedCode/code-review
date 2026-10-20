# open-review benchmark

Times `openReview` (`src/reviews.js`) against the fake cc of this tree (`tests/_fakeCc.js`), so a tree whose git runs
through `POST /api/exec` and one that runs git directly are measured on the same fixture. Not part of the test glob.

```bash
node harness/bench/open-review.mjs --tree <code-review checkout> [--runs 5]
```

- **Fixture:** a temp repo whose linked worktree changes every line of 300 files × 1000 lines (a range diff of ~20 MB), plus 200 untracked files in the main checkout.
- **range:** each run commits one tiny file on the worktree first, so HEAD moves and the committed-snapshot cache misses.
- **uncommitted:** the main checkout's working tree, 200 untracked files.
- **Output:** per run, the time, the file count and the exec calls the fake cc saw (0 for a tree that runs git directly), then the median per case. Each run uses a fresh `CODE_REVIEW_STORE`, so no review is reused.

Before/after comparison against `main`:

```bash
git worktree add "$(mktemp -d)/main" main
node harness/bench/open-review.mjs --tree <that dir>
node harness/bench/open-review.mjs --tree .
```

`main`'s `src/reviews.js` needs no `node_modules`.
