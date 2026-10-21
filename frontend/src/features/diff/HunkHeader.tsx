import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Row } from '@/lib/diffRows';
import { HunkBar } from './HunkBar';

/**
 * A hunk's header row. Collapsed (an accepted hunk): one summary button that expands it, no verdict bar.
 * Expanded and `toggleable`: the usual header with a collapse button.
 */
export function HunkHeader({ row, toggleable, onToggle }: { row: Extract<Row, { kind: 'hunk' }>; toggleable: boolean; onToggle: (open: boolean) => void }) {
  const { hunk } = row;
  if (row.collapsed && hunk.kind === 'text') {
    return (
      <div className="sticky left-0 border-y bg-muted/50 px-3 py-1 font-sans">
        <Button variant="ghost" aria-expanded={false} className="h-auto w-full min-w-0 justify-start gap-2 overflow-hidden" onClick={() => onToggle(true)}>
          <ChevronRightIcon />
          <span className="min-w-0 flex-1 truncate text-left font-mono text-xs text-muted-foreground">{hunk.header}</span>
          <Badge variant="success">accepted</Badge>
        </Button>
      </div>
    );
  }
  return (
    <div className="sticky left-0 border-y bg-muted/50 px-3 py-1 font-sans">
      {hunk.kind === 'text' && (toggleable ? (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" className="size-6" aria-expanded aria-label="Collapse hunk" onClick={() => onToggle(false)}><ChevronDownIcon /></Button>
          <p className="font-mono text-xs text-muted-foreground">{hunk.header}</p>
        </div>
      ) : <p className="font-mono text-xs text-muted-foreground">{hunk.header}</p>)}
      <HunkBar hunk={hunk} commentable={hunk.kind === 'text'} />
    </div>
  );
}
