# Store

One pretty-printed JSON file per review at `<root>/reviews/<id>.json` (`src/store.js`). Root: `$CODE_REVIEW_STORE`, else `$PROJECTS_ROOT/.code-review` (a dot-dir like the sibling `.code-hub`/`.code-live` stores, outside every project tree, so plugin updates and re-clones keep it). Resolved lazily: without a root only the API answers 503 `STORE_UNCONFIGURED`.

- Writes: tmp file in the same dir + `rename`; readers never see partial files. Every write bumps `rev` and emits `change` (the SSE feed).
- Mutations: `mutate(id, fn)` under `withLock(id)`; creation under `withLock('create')` so the reuse check and the write are one step. A no-op mutation writes nothing and does not bump `rev`.
- `seq`/`humanSeq`/`agentSeq` order all dialog activity within a review.
- Ids are validated (`r-<10 hex>`) before any path is built.
- Review files carry no format version. A format change ships a step in `migrateStore` (`src/migrate.js`), which `server.js` `start()` awaits before `listen`: each step fills only what is missing (so it self-checks and a second run writes nothing, `mutate` skipping unchanged reviews), a file it cannot read is logged (`logSkipped`, `not migrated`) and left as it is, and an unconfigured store is a no-op. Application code then reads the current shape only, with no fallbacks.
- `lastActivityAt` is the one wall-clock field logic reads (inbox order); see [../gotchas/inbox.md](../gotchas/inbox.md).
- **One bad review file must not take the plugin down, nor touch another review.** `store.ids()` lists id-shaped names without parsing; `store.list()` catches per file, logs through `logSkipped` and leaves the file as it is. The file still fails when that review is opened by id (500).
- **A file's name and its content's `id` must agree** (`MisfiledReview` in `read`). `write` persists under the content's id, so a copy restored under a new name, or a symlink into another store, would otherwise let any mutation overwrite the review its content names, or create one.
- **Log store-derived errors on one line** (`errorLine` in `src/text.js`, used by `logSkipped` and the route 500 handler): `JSON.parse` messages quote the file's bytes and `MisfiledReview` quotes the id inside it, newlines and escape sequences included. The 500 log keeps the stack's frames (`stackFrames`), but finds them by skipping V8's `name: message` header by line count, never by searching for the first `    at `: a message line can look like a frame.
- Full field list: `docs/architecture.md`.
