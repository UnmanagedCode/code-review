/** Counts of this many lines or more are compacted (`123k`, `1.2M`), which bounds a row's width; the exact numbers stay in the accessible name. */
const COMPACT_FROM = 10_000;
const compact = (n: number): string => {
  if (n < COMPACT_FROM) return String(n);
  const [div, unit] = n >= 1_000_000 ? [1_000_000, 'M'] : [1_000, 'k'];
  const v = n / div;
  return `${v < 10 ? Math.floor(v * 10) / 10 : Math.floor(v)}${unit}`;
};

/** A file's or folder's added and removed lines, green and red; nothing when both are 0 (binary, rename-only, mode-only). */
export function LineCounts({ additions, deletions }: { additions: number; deletions: number }) {
  if (additions === 0 && deletions === 0) return null;
  return (
    <span
      role="img" aria-label={`${additions} ${additions === 1 ? 'line' : 'lines'} added, ${deletions} removed`}
      className="inline-flex shrink-0 gap-1 font-mono text-xs tabular-nums"
    >
      <span aria-hidden className="text-success">+{compact(additions)}</span><span aria-hidden className="text-destructive">−{compact(deletions)}</span>
    </span>
  );
}
