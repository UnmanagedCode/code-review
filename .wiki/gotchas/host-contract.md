# Host contract gotchas

- **Every URL is relative.** A root-relative `/api/x` reaches cc's API, not this plugin. `api()` in `frontend/src/lib/api.ts` throws on a `/`-led path; Vite `base: './'` keeps assets relative.
- **No SPA fallback in `server.js`.** `/pluginBridge.js` and `/pluginTheme.css` must be a real 404 standalone; an HTML fallback makes the browser refuse a script/stylesheet with a different console error and breaks the "only these two errors" check. Routes live in the query string.
- **`frontend/index.html` head order is load-bearing:** bridge (blocking, no `defer`), theme sheet, `theme-init.js`. `vite-ignore` keeps Vite from warning on them.
- **No theme toggle of our own.** The bridge owns `<html class="dark">` when embedded; `frontend/src/lib/theme.ts` only observes it.
- **`cc-theme-fallback.css` is a one-time snapshot** inside `@layer base`; never refresh it to track cc. cc's served sheet is unlayered and wins.
- **Never navigate by assigning `location.hash`:** it adds a joint history entry the bridge cannot demote.
- **Mutating API calls need `Content-Type: application/json`, even body-less ones** (`refresh`, `submissions`, `DELETE`): otherwise 415. The check reads the header because `req.is` is null without a body. `frontend/src/lib/api.ts` does not set it yet; the UI must pass it in `init.headers`.
- **Storage keys** are prefixed `code-review:`; never touch `code-conductor:*`.
- **Content is text, never markup.** A guard test in `frontend/src/App.test.tsx` bans raw-HTML APIs in UI sources; links go through `safeHref`.
