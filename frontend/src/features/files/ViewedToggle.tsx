import { CheckIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useReviewCtx } from '@/state/reviewContext';
import { useShortcutHandler } from '@/state/shortcutRegistry';
import { useReviewActions } from '@/state/threads';
import { Tip } from '@/features/nav/Tip';

/**
 * The open file's viewed mark, in the file header. It owns the `v` key because the header is mounted exactly when a file is
 * open, on every layout (a narrow layout unmounts the tree then). Nothing to toggle read-only: no handler, so `v` keeps its default.
 */
export function ViewedToggle({ path }: { path: string }) {
  const { files, readOnly } = useReviewCtx();
  const actions = useReviewActions();
  const file = files.find((f) => f.path === path);
  const viewed = file?.viewed ?? false;
  const toggle = file && !readOnly ? () => { void actions.setViewed(path, !viewed); } : null;
  useShortcutHandler('toggle-viewed', toggle);
  if (!toggle) return null;
  return (
    <Tip label={viewed ? 'Clear the viewed mark' : 'Mark the file viewed'} id="toggle-viewed">
      <Button size="icon-sm" variant="outline" aria-label="Viewed" aria-pressed={viewed} className={cn(viewed && 'bg-success/20 text-foreground hover:bg-success/25')} onClick={toggle}>
        <CheckIcon />
      </Button>
    </Tip>
  );
}
