import { SlidersHorizontalIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tip } from '@/features/nav/Tip';
import { CONTEXT_CHOICES, DEFAULT_CONTEXT, useDiffPrefs } from '@/state/diffPrefs';

/** The display-only Diff options (Ignore whitespace, Context lines) behind one labelled button; non-default settings show as a dot and in its name. */
export function DiffOptions() {
  const { context, ignoreWhitespace, setPrefs } = useDiffPrefs();
  const changed = [ignoreWhitespace && 'ignoring whitespace', context !== DEFAULT_CONTEXT && `${context} context ${context === 1 ? 'line' : 'lines'}`].filter(Boolean);
  return (
    <DropdownMenu>
      <Tip label="Diff options">
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="relative" aria-label={['Diff options', ...changed].join(' · ')}>
            <SlidersHorizontalIcon />Options
            {changed.length > 0 && <span aria-hidden className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-primary" />}
          </Button>
        </DropdownMenuTrigger>
      </Tip>
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
