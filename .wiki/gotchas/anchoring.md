# Anchoring gotchas

- **Hunk ids exclude line numbers and context** (`src/diff.js`, `assignIds`): an edit elsewhere in the file shifts or re-contextualises a hunk without losing its verdict. Any change to the hunk's own +/- lines, or a merge with a neighbouring hunk, gives a new id (reads as pending). The path is hashed, so a rename resets every hunk of the file.
- **Identical +/- blocks in one file** are told apart by their occurrence index.
- **`linesHash` strips trailing `[ \t\r]` only**; leading indentation is significant. CRLF files hash the same as LF.
- **Two locate modes** (`src/anchor.js`): `reanchor` (range refresh) falls back to a unique context sandwich and marks the anchor `drifted`; `volatile` (uncommitted sweep) never falls back, so a pure line shift follows but any content change drops the thread.
- **Duplicate windows** are ranked by context matches, then nearness to the old start, then earliest line.
- **A range can span hunks.** `hunkFor` assigns the hunk containing `endLine` (threads render under their last line), else the last hunk overlapped, else null (pure context).
- **Anchor `file` is always the new path** of the file in the snapshot; the old side is read through `oldPath`. Refresh maps renamed files with a rename map between the previous and new head.
- **`anchor.round` and `drifted` follow the latest re-anchor:** `followThreads` sets the round to the new one (its `lines`/`linesHash` are re-read from that snapshot) and an exact match clears `drifted`.
- **Earlier positions live in `pastAnchors`, not in `anchor`.** `followThreads` pushes the old anchor (positional fields only, `anchorView`) whenever it moves a thread into a different round. The guard is `a.round !== round`, not "mode is reanchor": the uncommitted sweep runs on every request within one round and must add nothing, but its first run after an uncommitted refresh does add one. `threadsAt` in `src/history.js` picks the latest entry at or before the viewed round.
- **The outdated round and the pre-outdated status are derived.** Outdated threads are never followed again, so the last chain entry is the last round they were located in (outdated from the next one). Going outdated changes only `status`, so `resolution` still says whether it was resolved. Open/resolved as of an older round is *not* derivable: only the latest status change is stored and rounds carry no `seq`.
- **Threads from schema 1 have an empty `pastAnchors`** (the migration cannot reconstruct positions), so rounds between their creation and their `anchor.round` show them as "position unknown", never at a guessed place.
- **Binary/too-large files take no anchors and no line reads or citations.** One predicate (`isBinaryFile` in `src/snapshot.js`): in the diff → the snapshot's flags (git honours `.gitattributes`); outside the diff → NUL scan (content is read only then, so a flagged file is refused unread).
- **Dropped uncommitted threads** are remembered in `droppedThreads` so a late reply says `THREAD_DROPPED`, not `THREAD_UNKNOWN`.
- **Outdated threads** are never re-anchored again but accept replies; the human cannot change their status.
