/** A file's or folder's added and removed lines, green and red; nothing when both are 0 (binary, rename-only, mode-only). */
export function LineCounts({ additions, deletions }: { additions: number; deletions: number }) {
  if (additions === 0 && deletions === 0) return null;
  return (
    <span
      role="img" aria-label={`${additions} ${additions === 1 ? 'line' : 'lines'} added, ${deletions} removed`}
      className="inline-flex shrink-0 gap-1 font-mono text-xs tabular-nums"
    >
      <span aria-hidden className="text-success">+{additions}</span><span aria-hidden className="text-destructive">−{deletions}</span>
    </span>
  );
}
