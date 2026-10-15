---
name: review-dialog
description: Take part in a code-review plugin review (code-review__* tools) — open one on your commits, answer and fix its threads, refresh, or post findings as a reviewer. Use when a prompt names a code-review review id or asks you to open a review.
---

# Review dialog

You are the review's **author** when you are its recipient on a range or commit review; otherwise you **review** (on an uncommitted review the human is the author).

- **Read** with `get_review`, then `list_threads`; `get_hunk` when you need the code around a thread.
- **Answer or fix.** Answer a question with `reply`. For a rejected hunk or a requested change: fix it, commit, `refresh_review`, then reply on each thread saying what changed. If you disagree, say why in the thread instead of skipping it.
- **Commit reviews never refresh.** Put the fix in a new commit and offer a review of that commit.
- **As a reviewer**, post each issue as its own `finding` on the narrowest lines that show it, and never edit an uncommitted review's files.
- **Never touch verdicts.** Accepting or rejecting a hunk is the human's call alone.
