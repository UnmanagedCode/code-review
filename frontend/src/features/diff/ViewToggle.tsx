import { Button } from '@/components/ui/button';
import { SEGMENT } from '@/features/common/segment';
import type { DiffView } from './useDiffView';

const VIEWS: { value: DiffView; label: string }[] = [{ value: 'inline', label: 'Inline' }, { value: 'split', label: 'Split' }];

/** Inline / Split segmented toggle for the file's diff. */
export function ViewToggle({ view, onChange }: { view: DiffView; onChange: (v: DiffView) => void }) {
  return (
    <div role="group" aria-label="Diff view" className="inline-flex rounded-md border">
      {VIEWS.map((v) => (
        <Button key={v.value} size="sm" variant="ghost" aria-pressed={view === v.value} className={SEGMENT} onClick={() => onChange(v.value)}>
          {v.label}
        </Button>
      ))}
    </div>
  );
}
