import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { GRID_KEYS, SHORTCUTS, type ShortcutGroup } from '@/lib/shortcuts';
import { useRegisteredShortcuts } from '@/state/shortcutRegistry';
import { useJumpNav } from './jumpNavContext';

const GROUPS: ShortcutGroup[] = ['Threads', 'Hunks', 'Files', 'Review'];

function Keys({ keys }: { keys: string }) {
  return <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs whitespace-nowrap">{keys}</kbd>;
}

function Section({ title, rows }: { title: string; rows: { keys: string; label: string }[] }) {
  return (
    <section className="break-inside-avoid">
      <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
      <dl className="flex flex-col gap-1">
        {rows.map((r) => (
          <div key={r.keys} className="flex items-baseline justify-between gap-3 text-sm">
            <dt>{r.label}</dt>
            <dd><Keys keys={r.keys} /></dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** The `?` cheat sheet: the shortcuts that act right now (the registered ones), then the line-selection keys of the diff grid. */
export function ShortcutsDialog() {
  const { overlay } = useJumpNav();
  const registered = useRegisteredShortcuts();
  return (
    <Dialog open={overlay.open} onOpenChange={overlay.setOpen}>
      <DialogContent
        className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl"
        // The global listener ignores keys typed inside a dialog, so `?` closes it from here.
        onKeyDown={(e) => { if (e.key === '?') { e.preventDefault(); overlay.setOpen(false); } }}
      >
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Press ? or Esc to close. Shortcuts never act while you type in a field.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 min-[40rem]:grid-cols-2">
          {GROUPS.map((g) => {
            const rows = SHORTCUTS.filter((s) => s.group === g && registered.has(s.id));
            return rows.length ? <Section key={g} title={g} rows={rows} /> : null;
          })}
          <Section title="Line selection (in the diff)" rows={[...GRID_KEYS]} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
