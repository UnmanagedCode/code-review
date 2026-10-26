import { SlidersHorizontalIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CONTEXT_CHOICES, DEFAULT_CONTEXT, useDiffPrefs } from '@/state/diffPrefs';

/** The display-only Diff options (Ignore whitespace, Context lines) behind one icon button; non-default settings show as a dot and in its name. */
export function DiffOptions() {
  const { context, ignoreWhitespace, setPrefs } = useDiffPrefs();
  const changed = [ignoreWhitespace && 'ignoring whitespace', context !== DEFAULT_CONTEXT && `${context} context ${context === 1 ? 'line' : 'lines'}`].filter(Boolean);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="relative" aria-label={['Diff options', ...changed].join(' · ')}>
          <SlidersHorizontalIcon />
          {changed.length > 0 && <span aria-hidden className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-primary" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuCheckboxItem checked={ignoreWhitespace} onCheckedChange={(on) => setPrefs({ ignoreWhitespace: on === true })}>
          Ignore whitespace
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Context lines</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={String(context)} onValueChange={(v) => setPrefs({ context: Number(v) })}>
          {CONTEXT_CHOICES.map((n) => <DropdownMenuRadioItem key={n} value={String(n)}>{n}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
