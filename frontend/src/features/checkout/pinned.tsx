export interface Opt { value: string; label: string }

/** `top`: the `items` named in `pinned`, in `pinned` order and deduped; `rest`: the others in their original order. */
export function pinFirst(items: Opt[], pinned: readonly string[]): { top: Opt[]; rest: Opt[] } {
  const top = [...new Set(pinned)].flatMap((v) => items.filter((o) => o.value === v));
  return { top, rest: items.filter((o) => !top.includes(o)) };
}

const options = (items: Opt[]) => items.map((o) => <option key={o.value} value={o.value}>{o.label}</option>);

/** The options of a select, with the pinned ones in an "Active session" group above the rest; flat when nothing is pinned. */
export function PinnedOptions({ items, pinned, restLabel }: { items: Opt[]; pinned: readonly string[]; restLabel: string }) {
  const { top, rest } = pinFirst(items, pinned);
  if (!top.length) return <>{options(items)}</>;
  return (
    <>
      <optgroup label="Active session">{options(top)}</optgroup>
      {rest.length > 0 && <optgroup label={restLabel}>{options(rest)}</optgroup>}
    </>
  );
}
