# Anchoring gotchas

- **Hunk ids exclude line numbers and context** (`src/diff.js`, `assignIds`): an edit elsewhere in the file shifts or re-contextualises a hunk without losing its verdict. Any change to the hunk's own +/- lines, or a merge with a neighbouring hunk, gives a new id (reads as pending). The path is hashed, so a rename resets every hunk of the file.
- **Identical +/- blocks in one file** are told apart by their occurrence index.
- **`linesHash` strips trailing `[ \t\r]` only**; leading indentation is significant. CRLF files hash the same as LF.
- **Two locate modes** (`src/anchor.js`): `reanchor` (range refresh) falls back to a unique context sandwich and marks the anchor `drifted`; `volatile` (uncommitted sweep) never falls back, so a pure line shift follows but any content change drops the thread.
- **Duplicate windows** are ranked by context matches, then nearness to the old start, then earliest line.
- **A range can span hunks.** `hunkFor` assigns the hunk containing `endLine` (threads render under their last line), else the last hunk overlapped, else null (pure context).
- **Anchor `file` is always the new path** of the file in the snapshot; the old side is read through `oldPath`. Refresh maps renamed files with a rename map between the previous and new head.
- **`anchor.round` and `drifted` follow the latest re-anchor:** `followThreads` sets the round to the new one (its `lines`/`linesHash` are re-read from that snapshot) and an exact match clears `drifted`.
- **Binary/too-large files take no anchors and no line reads or citations.** One predicate (`isBinaryFile` in `src/snapshot.js`): in the diff → the snapshot's flags (git honours `.gitattributes`); outside the diff → NUL scan.
- **Dropped uncommitted threads** are remembered in `droppedThreads` so a late reply says `THREAD_DROPPED`, not `THREAD_UNKNOWN`.
- **Outdated threads** are never re-anchored again but accept replies; the human cannot change their status.
