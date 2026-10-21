import { RouteLink } from '@/components/RouteLink';
import * as ep from '@/lib/endpoints';
import { parseLines, useRoute } from '@/lib/route';
import { useReviewCtx } from '@/state/reviewContext';
import { useFetch } from '@/state/useFetch';
import { Empty, ErrorState, Loading } from '@/features/common/States';

/**
 * Read-only excerpt of a cited file that is not part of the diff. In a comparison the sides are the two rounds' heads:
 * `old` reads round A's, `new` round B's.
 */
export function CitedExcerpt({ path }: { path: string }) {
  const { id, round, compare } = useReviewCtx();
  const route = useRoute();
  const range = parseLines(route.lines);
  const side = compare ? 'new' : route.side ?? 'new';
  const at = compare ? (route.side === 'old' ? compare.from : compare.to) : round;
  const excerpt = useFetch(range ? () => ep.fileLines(id, path, side, range.start, range.end, at) : null, [id, path, route.lines, side, at]);
  if (!range) return <Empty title="That file isn’t in this diff" />;
  if (excerpt.loading && !excerpt.data) return <Loading label="Loading excerpt" rows={3} />;
  if (excerpt.error) {
    return (excerpt.error as { code?: string }).code === 'FILE_NOT_IN_DIFF'
      ? <Empty title="Cited file isn’t present at this round" />
      : <ErrorState error={excerpt.error} onRetry={excerpt.reload} />;
  }
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <p className="min-w-0 flex-1 truncate font-mono text-sm" title={path}>{path}</p>
        <span className="text-xs text-muted-foreground">not in this diff · read-only</span>
        <RouteLink to={{ file: undefined, lines: undefined, side: undefined }} className="text-xs underline">Close</RouteLink>
      </div>
      <div role="table" aria-label={`Excerpt of ${path}`} className="overflow-x-auto font-mono text-xs leading-5">
        {excerpt.data?.lines.map((l) => (
          <div role="row" key={l.n} className="flex w-max min-w-full">
            <div role="cell" className="w-12 shrink-0 px-1 text-right text-muted-foreground select-none">{l.n}</div>
            <div role="cell" className="px-3 whitespace-pre">{l.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
