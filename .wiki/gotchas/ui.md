# UI gotchas

- **The selection clamps at a collapsed gap.** `extendSelection` stops before a gap row; once the gap is expanded the range may span both hunks (the backend accepts it). `frontend/src/lib/selection.ts`.
- **Hold the selection toolbar back while dragging.** Inserting it under the first row shifts the rows below it, so the pointer ends up over the toolbar and the drag never extends. It appears on pointer release.
- **The SSE echo of our own write is ignored.** Write responses carry the review summary; `applyReview` raises `knownRev`, so the following event has `rev <= knownRev` and triggers no refetch. Anything that bypasses `applyReview` causes one redundant refetch (harmless).
- **Verdicts are the only optimistic write** (per hunk and Accept file). Everything else waits for the server; a refused verdict reverts and toasts.
- **Accept file sends the hunk ids the UI shows as pending, never just the path.** A path alone would let the server accept hunks added by a refresh the UI hasn't loaded, or flip a reject another tab set. The server also skips any hunk that already has a verdict. `acceptFile` in `src/reviews.js`, `FileVerdict` in `frontend/src/features/diff/FileVerdict.tsx`.
- **A bridge timeout or an unknown bridge code posts no result.** The prompt may have been delivered, and the backend refuses codes outside its list. The timed-out dialog's Retry warns that it could deliver twice.
- **Citations are linked from the route serialiser, never from the raw text.** Paths starting with `/` or containing `..` stay text.
- **The route wins on load.** A checkout named by the URL beats cc's active session, which beats the stored last checkout; only later session changes switch the checkout.
- **Uncommitted reviews need polling.** Working-tree edits emit no event, so the page refetches on focus and an interval; threads that vanish become session-local tombstones.
- **The file header's path keeps a flex-basis.** With only `min-w-0 flex-1` it shrinks to "a…" in the narrow desktop middle pane and the header's `flex-wrap` never kicks in; the basis makes the controls wrap instead. `FileHeader` in `frontend/src/features/diff/FileDiff.tsx`.
- **happy-dom has no layout.** Row geometry, drag across real rows, sticky headers and overflow are checked in the Playwright harness, not in unit tests. A UI change that moves elements under the pointer is only caught there.
- **RTL `waitFor` hangs under vitest fake timers;** use `vi.waitFor`. `userEvent.setup()` replaces `navigator.clipboard`, so spy on it after `setup()`.
- **Rebuild `frontend/dist` (`npm run prepare`) before running the harness;** the server serves the built bundle.
