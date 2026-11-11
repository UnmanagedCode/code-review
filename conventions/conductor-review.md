# Review in code-review (opt-in per task)

Only when the user asks for a task to be reviewed in code-review, invoke the `cc-conductor-code-review:review-in-code-review` skill.

<!-- cc:skill Use when the user asks for a task to be reviewed in code-review. -->

- Once the worker has committed, call `code-review__open_review({project, worktree, author: <worker sessionId>})` yourself and put the returned review id in every brief for that task.
- If the returned review's recipient is not you, the worker already opened it and receives its rounds directly: don't relay them.
- Brief each reviewer lens to post its issues into that review as `finding`s instead of in its report.
- Read the findings with `list_threads` and arbitrate them as usual; once your ruling on a finding is final, close it with `reply` (`resolve: true` and its `disposition`) so the review records it.
- Hold `merge_worktree` while `get_review` reports `mergeBlockers` above 0.
- To point the user at the review or one of its threads, give that item's `link` from the tool result unchanged as a `[▶ Open review](<link>)` button.
