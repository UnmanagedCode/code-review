import { useMemo, useState } from 'react';

interface State { key: string; prevSettled: string[]; open: ReadonlySet<string> }
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Settled items (accepted hunks `h:<id>`, resolved threads `t:<id>`) render collapsed unless opened.
 * Overrides are view-only, in memory and per open file (`resetKey`). An item that stops being settled loses its
 * override, so settling it again collapses it; one that becomes settled while `keepOpen` says so starts open.
 * `forced` items are always shown and offer no toggle; pass a memoised set.
 */
export function useCollapse(o: { settled: string[]; forced: ReadonlySet<string>; resetKey: string; keepOpen: (id: string) => boolean }) {
  const { settled, forced, resetKey, keepOpen } = o;
  const [state, setState] = useState<State>(() => ({ key: resetKey, prevSettled: settled, open: new Set() }));
  // Adjusted during render, not in an effect: an effect would commit one frame with a just-settled hunk collapsed,
  // unmounting an open Composer under it.
  let cur = state;
  // What is settled when a file (re)loads is collapsed; only later transitions consult keepOpen.
  if (cur.key !== resetKey) cur = { key: resetKey, prevSettled: settled, open: new Set() };
  if (!same(cur.prevSettled, settled)) {
    const was = new Set(cur.prevSettled);
    const now = new Set(settled);
    const open = new Set([...cur.open].filter((id) => now.has(id)));
    for (const id of settled) if (!was.has(id) && keepOpen(id)) open.add(id);
    cur = { key: resetKey, prevSettled: settled, open };
  }
  if (cur !== state) setState(cur);

  const settledKey = settled.join('\n');
  const settledSet = useMemo(() => new Set(settled), [settledKey]);
  const collapsed = useMemo<ReadonlySet<string>>(
    () => new Set([...settledSet].filter((id) => !cur.open.has(id) && !forced.has(id))),
    [settledSet, forced, cur.open],
  );
  return {
    collapsed,
    toggleable: (id: string) => settledSet.has(id) && !forced.has(id),
    setOpen: (id: string, open: boolean) => setState((s) => {
      if (open === s.open.has(id) || (open && !settledSet.has(id))) return s;
      const next = new Set(s.open);
      if (open) next.add(id); else next.delete(id);
      return { ...s, open: next };
    }),
  };
}
