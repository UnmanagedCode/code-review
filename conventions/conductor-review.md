# Review in code-review (opt-in per task)

Your default review flow is unchanged. Only when the user asks for a task to be reviewed in code-review:

- Once the worker has committed, call `code-review__open_review({project, worktree, author: <worker sessionId>})` yourself and put the returned review id in every brief for that task.
- If the returned review's recipient is not you, the worker already opened it and receives its rounds directly: don't relay them.
- Brief each reviewer lens to post its issues into that review as `finding`s instead of in its report.
- Read the findings with `list_threads` and arbitrate them as usual.
- Hold `merge_worktree` while `get_review` reports `mergeBlockers` above 0.
