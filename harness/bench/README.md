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

# highlight benchmark

Worst-case syntax-highlighting time per bundled language, for choosing `HIGHLIGHT_MAX_SIDE_CHARS_BY_LANG` (`frontend/src/lib/highlight/index.ts`). Loads the grammars `frontend/src/lib/highlight/prism.ts` imports, in its order, and runs stress sides through the real `highlightLines` with every cap applied. Not part of the test glob; needs `npm install` (prismjs) and Node with type stripping (≥ 23.6).

```bash
node harness/bench/highlight.mjs                    # each language at its cap: cold (first run) and warm (fastest of 3) worst case
node harness/bench/highlight.mjs --search           # per language, the largest side in SEARCH_SIZES whose warm worst fits TARGET_MS
node harness/bench/highlight.mjs --lang typescript  # one language
```

- **Inputs:** `GENERATORS` (dense tokens, nesting, interpolation, and lines of unterminated literals, the input that makes Prism's greedy patterns quadratic), each at 199- and 1999-character lines up to the side size.
- **Isolation:** without `--lang` each language runs in its own process; one long process accumulates heap and GC pauses that inflate later languages up to 2×.
- Re-run after adding a grammar, changing a cap or upgrading prismjs, and record the numbers in `.wiki/gotchas/diff-display.md`.
