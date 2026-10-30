# Cross-plugin links (code-git ↔ code-review)

Contracts: `docs/protocol.md` → UI routes, "New review links" and "Open in code-git".

## Outbound: "Open in code-git"

- **cc has no bridge call that opens another plugin's view** (the bridge offers `openSession` and `sendPrompt` only). The link is therefore an `<a target="_top">` that navigates cc's top document. This is the one sanctioned top-frame navigation; the "never assign `location.hash`" rule in [host-contract.md](host-contract.md) is about our own frame.
- **Why it doesn't reload cc.** The href is `topBase()` (cc's current `pathname + search`, read from `window.top.location`) plus `#plugin/<id>/?…`. A URL that differs from the current one only in its fragment is a same-document navigation: cc's `hashchange` listener re-parses the route and its plugin view mounts code-git. An absolute or differently-pathed href would reload cc.
- **MCP `link`s are the opposite case:** the links `open_review`, `get_review` and `list_threads` return are absolute `http://cc.internal/#plugin/…` URLs (`CC_ORIGIN`, `src/links.js`). cc opens each one in its plugin view, or in the plugin dock when that is showing. A model given a bare fragment prepends a guessed host, while a complete URL passes through unchanged. Never use that form for a top-frame href, which must stay a fragment navigation.
- **It works only because plugin iframes are same-origin and unsandboxed** (cc proxies `/plugins/<id>/…` and sends `X-Frame-Options: SAMEORIGIN`). `topBase()` returns null when standalone, when unframed, or when reading `top.location` throws, and the link then hides.
- **`closeView` cost.** The entry this pushes has `history.state === null`, not cc's own view-visit marker, so Escape or close on code-git's view goes to the session anchor instead of `history.back()`. Browser Back still returns. This stays a documented limitation until cc ships a bridge call for opening another plugin.
- **The backend owns code-git's id** (`CODE_GIT_PLUGIN` in `src/integrations.js`). `GET /api/integrations` checks cc's plugin list (`enabled && hasFrontend`); the frontend never hard-codes the id. `useCodeGit` fetches it once per page and only when `topBase()` is non-null, so standalone pages and unframed tests make no request.
- **`commit` is always a full sha.** A commit filter from an MCP link may be abbreviated (the server matches prefixes), so `CodeGitFileLink` looks it up in the review's commits before linking. `shownHeadSha` gives the commit the diff's new side shows: the commit filter, the viewed round's head, the comparison's later round's head, else the review's head.
- **The file link hides where the commit has no such file:** a deleted file, and an uncommitted review's added (or untracked) and renamed files, whose new side is the working tree and not `headSha`.

## Inbound: New review prefill

- **The dialog is keyed by `project\0worktree\0range\0sha`** in `App`, so cc steering an open frame to another link (`popstate`) remounts it with the new prefill. This mirrors `ReviewView` being keyed by review ([ui.md](ui.md)).
- **The prefill is applied once.** The `pending` state gates the apply effect, which runs only when the resolved refs and the checkout have both loaded. It is declared after the fork-point default effect, so when both run in one commit the prefill wins. A later re-render never re-applies it over the human's edits.
- **A fork-point base stays a ref.** When the link's raw base equals a fork point's `ref`, that radio is chosen and the stored `target.base` is the ref, just as when the human picks it. Any other base becomes Another commit with the resolved full sha; the picker gets it as `extra`, since `CommitPicker` lists only the last 50 commits.
- **The head must equal the checkout's HEAD.** A range review is always `base...<checkout HEAD>` (`resolveTarget` in `src/snapshot.js`, and Refresh follows HEAD), so a link with any other head is refused with a message, not silently retargeted.
- **The server is the only ref validator.** `parsePrefill` checks only the shape (one key, a separator, two non-empty sides). Refs go through `GET /api/checkout/commit` (`git.checkRef` → `BAD_REF`, `git.resolveCommit` → `REF_UNKNOWN`), the same path as `POST /reviews`.
- **`range`/`sha` are in `REVIEW_SCOPED`, and `NEW_REVIEW_CLOSED` clears them,** so a prefill never leaks into the review it opened or into the next dialog. `src/links.js` never builds these keys (its `ORDER` stops before `view`).
