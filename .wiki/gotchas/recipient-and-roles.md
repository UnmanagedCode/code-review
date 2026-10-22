# Recipient and roles

- **An agent opener is always the recipient.** `openReview` (`src/reviews.js`) sets it from the actor; only the human path (`POST /reviews`) takes a `recipient`.
- **Only the human path resolves a recipient** (explicit, else the single live attached session, else none).
- **Reuse never reassigns.** A reused review comes back as stored, whatever the second caller passes.
- **A conductor-opened review carries `author`** (range/commit only, conductor callers only). `null` means recipient = author.
- **One role derivation:** `roleOf` in `src/context.js`. `recipientRole` reads `conductor` from `createdBy`, so a human assigning a conductor session to a human-created review still reads `author`.
- **`AUTHOR_UNKNOWN` is MCP-only:** a human `author` is refused `INVALID_ARGUMENT` first, so the UI has no copy for it.
- **The prompt body follows the review kind, the closing line the role** (`src/prompt.js`): a range review can have a `reviewer` recipient.
- **Resolve rights:** `mayClose` in `src/threads.js`. Only an open thread closes: the conductor and the thread's opening agent close an agent-opened one (a finding needs a disposition); `disposition` from any other agent, or without `resolve`, is refused. User-opened, resolved and outdated threads only ever get a proposal, so an agent never overrides a human's close. Outdated is frozen because past-round status is derived from `resolution`.
- **Owner** = `openedBy.kind` (`human` → user, `session` → agents), the same in `listThreads` and the Threads tab's owner select.
