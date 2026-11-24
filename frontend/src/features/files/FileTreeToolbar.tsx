import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { filterFiles, isFiltered, undecidedFile } from '@/lib/fileFilter';
import { navigate, useRoute } from '@/lib/route';
import type { FileState } from '@/lib/types';
import { clearFileFilter, setFileFilter, useFileFilter } from '@/state/fileFilter';
import { useReviewCtx } from '@/state/reviewContext';
import { useShortcutHandler } from '@/state/shortcutRegistry';
import { cn } from '@/lib/utils';

const PANE_TABS = ['threads', 'history', 'guided'];

function Toggle({ label, count, on, onChange }: { label: string; count: number; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <Button size="sm" variant="outline" aria-pressed={on} className={cn('h-7 px-2 text-xs', on && 'bg-primary/15')} onClick={() => onChange(!on)}>
      {label} {count}
    </Button>
  );
}

/**
 * The tree's filter box, its Needs me and Undecided toggles (OR'd when both are on; the text applies on top), and the viewed
 * progress. Registers `/` while mounted: it brings the Files tab forward and focuses the box. `files`: every file of the view;
 * `shown`: how many the filter keeps.
 */
export function FileTreeToolbar({ files, shown, needsYou, live }: { files: FileState[]; shown: number; needsYou: ReadonlyMap<string, number>; live: boolean }) {
  const { id, review } = useReviewCtx();
  const route = useRoute();
  const filter = useFileFilter(id);
  const input = useRef<HTMLInputElement>(null);
  const wantFocus = useRef(false);
  const showTab = PANE_TABS.includes(route.view ?? '');
  const filtered = isFiltered(filter);
  const needsCount = filterFiles(files, { text: '', needsMe: true, undecided: false }, needsYou).length;
  const undecidedCount = files.filter(undecidedFile).length;
  const viewed = files.filter((f) => f.viewed).length;

  const focusBox = () => { input.current?.focus(); input.current?.select(); };
  // Another pane tab keeps this box in a hidden tabpanel, so focusing waits for the render that shows the Files tab.
  useEffect(() => {
    if (!wantFocus.current || showTab) return;
    wantFocus.current = false;
    focusBox();
  }, [showTab]);
  useShortcutHandler('focus-file-filter', () => {
    if (showTab) {
      wantFocus.current = true;
      navigate({ view: undefined }, { replace: true });
    } else focusBox();
    return true;
  });

  return (
    <div className="flex flex-col gap-1.5 border-b px-3 py-2">
      <Input
        ref={input} id="file-filter" type="search" aria-label="Filter files" placeholder="Filter files  ( / )" className="h-8"
        value={filter.text} onChange={(e) => setFileFilter(id, { text: e.target.value })}
        onKeyDown={(e) => { if (e.key === 'Escape' && filter.text) { e.stopPropagation(); setFileFilter(id, { text: '' }); } }}
      />
      {live && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Toggle label="Needs me" count={needsCount} on={filter.needsMe} onChange={(needsMe) => setFileFilter(id, { needsMe })} />
          {review.kind !== 'uncommitted' && <Toggle label="Undecided" count={undecidedCount} on={filter.undecided} onChange={(undecided) => setFileFilter(id, { undecided })} />}
          <span className="ml-auto text-xs text-muted-foreground">{viewed} of {files.length} viewed</span>
        </div>
      )}
      {filtered && (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          Showing {shown} of {files.length} files ·
          <Button size="sm" variant="link" className="h-auto p-0 text-xs" onClick={() => clearFileFilter(id)}>Clear filter</Button>
        </p>
      )}
    </div>
  );
}
