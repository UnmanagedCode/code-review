# Store

One pretty-printed JSON file per review at `<root>/reviews/<id>.json` (`src/store.js`). Root: `$CODE_REVIEW_STORE`, else `$PROJECTS_ROOT/.code-review` (a dot-dir like the sibling `.code-hub`/`.code-live` stores, outside every project tree, so plugin updates and re-clones keep it). Resolved lazily: without a root only the API answers 503 `STORE_UNCONFIGURED`.

- Writes: tmp file in the same dir + `rename`; readers never see partial files. Every write bumps `rev` and emits `change` (the SSE feed).
- Mutations: `mutate(id, fn)` under `withLock(id)`; creation under `withLock('create')` so the reuse check and the write are one step. A no-op mutation writes nothing and does not bump `rev`.
- `seq`/`humanSeq` order all dialog activity; logic never reads the wall clock.
- Ids are validated (`r-<10 hex>`) before any path is built.
- `schema` is `SCHEMA` in `src/migrate.js` (the single source; `openReview` writes it). `server.js` `start()` awaits `migrateStore()` before listening; migrations self-check (`schema >= SCHEMA` → no-op) and go through `mutate`, so an already-current review is never rewritten. 1 → 2 adds `pastAnchors: []` to threads (`??=`: never discards an existing value).
- **Anything that boots the server migrates the store it points at.** Tests that call `start()` must set `CODE_REVIEW_STORE` to a temp dir first (`tempStore()`), or a `PROJECTS_ROOT` in the environment would make them rewrite the real store.
- Full field list: `docs/architecture.md`.
