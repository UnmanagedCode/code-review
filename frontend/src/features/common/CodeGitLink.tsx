import { GitGraphIcon } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { shownHeadSha, useCodeGitHref, type CodeGitTarget } from '@/lib/codeGit';
import * as ep from '@/lib/endpoints';
import type { DiffFile } from '@/lib/types';
import { useReviewCtx } from '@/state/reviewContext';
import { useFetch } from '@/state/useFetch';

/**
 * An icon link that opens code-git's view in cc; renders nothing standalone or without code-git.
 * `target="_top"` is the one sanctioned top-frame navigation (see .wiki/gotchas/cross-plugin-links.md); a plain anchor keeps "open in new tab".
 */
export function CodeGitLink({ target, label }: { target: CodeGitTarget | null; label: string }) {
  const href = useCodeGitHref(target);
  if (!href) return null;
  return (
    <a href={href} target="_top" aria-label={label} title={label} className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}>
      <GitGraphIcon />
    </a>
  );
}

/** The open file's history in code-git, at the commit the diff's new side shows; none where that commit has no such file. */
export function CodeGitFileLink({ file }: { file: DiffFile }) {
  const ctx = useReviewCtx();
  const { review, commit } = ctx;
  // A commit filter from a link may be abbreviated: the review's commits give its full sha.
  const commits = useFetch(commit && !/^[0-9a-f]{40}$/.test(commit) ? () => ep.reviewCommits(ctx.id) : null, [ctx.id, commit]);
  const sha = shownHeadSha(ctx, commits.data?.commits);
  const absent = file.status === 'deleted' || (review.kind === 'uncommitted' && (file.status === 'added' || file.status === 'renamed'));
  const target = sha && !absent ? { project: review.project, worktree: review.worktree, commit: sha, path: file.path } : null;
  return <CodeGitLink target={target} label={`Open the history of ${file.path} in code-git`} />;
}
