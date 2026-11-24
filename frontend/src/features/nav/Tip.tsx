import type { ReactElement } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { keysOf, type ShortcutId } from '@/lib/shortcuts';

/** A tooltip over one control: `label`, then the key of catalog shortcut `id` when it has one. */
export function Tip({ label, id, children }: { label: string; id?: ShortcutId; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}{id && <> <kbd className="ml-1 font-mono opacity-80">{keysOf(id)}</kbd></>}</TooltipContent>
    </Tooltip>
  );
}
