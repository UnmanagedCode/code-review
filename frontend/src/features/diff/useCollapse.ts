import { useMemo, useState } from 'react';

interface State { key: string; prevSettled: string[]; open: ReadonlySet<string>; pinned: string | null; released: boolean }
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Settled items (accepted hunks `h:<id>`, resolved threads `t:<id>`) render collapsed unless opened.
 * Overrides are view-only, in memory and per open file (`resetKey`). An item that stops being settled loses its
 * override, so settling it again collapses it; one that becomes settled while `keepOpen` says so starts open.
 * `forced` items (hunks) are always shown and offer no toggle; pass a memoised set.
 * `pinned` is the routed item: shown and untoggleable like a forced one, until it becomes settled while pinned. That
 * releases it, so it collapses and toggles like any settled item. A new `pinned` or a file (re)load pins it again.
 */
export function useCollapse(o: { settled: string[]; forced: ReadonlySet<string>; pinned: string | null; resetKey: string; keepOpen: (id: string) => boolean }) {
  const { settled, forced, pinned, resetKey, keepOpen } = o;
  const [state, setState] = useState<State>(() => ({ key: resetKey, prevSettled: settled, open: new Set(), pinned, released: false }));
  // Adjusted during render, not in an effect: an effect would commit one frame with a just-settled hunk collapsed,
  // unmounting an open Composer under it.
  let cur = state;
  // What is settled when a file (re)loads is collapsed; only later transitions consult keepOpen.
  if (cur.key !== resetKey) cur = { key: resetKey, prevSettled: settled, open: new Set(), pinned, released: false };
  if (cur.pinned !== pinned) cur = { ...cur, pinned, released: false };
  if (!same(cur.prevSettled, settled)) {
    const was = new Set(cur.prevSettled);
    const now = new Set(settled);
    const open = new Set([...cur.open].filter((id) => now.has(id)));
    for (const id of settled) if (!was.has(id) && keepOpen(id)) open.add(id);
    let released = cur.released;
    if (pinned !== null && now.has(pinned) && !was.has(pinned)) released = true;
    else if (pinned !== null && !now.has(pinned)) released = false;
    cur = { ...cur, prevSettled: settled, open, released };
  }
  if (cur !== state) setState(cur);

  const settledKey = settled.join('\n');
  const settledSet = useMemo(() => new Set(settled), [settledKey]);
  const collapsed = useMemo<ReadonlySet<string>>(
    () => new Set([...settledSet].filter((id) => !cur.open.has(id) && !forced.has(id) && (id !== cur.pinned || cur.released))),
    [settledSet, forced, cur.open, cur.pinned, cur.released],
  );
  return {
    collapsed,
    toggleable: (id: string) => settledSet.has(id) && !forced.has(id) && !(id === cur.pinned && !cur.released),
    setOpen: (id: string, open: boolean) => setState((s) => {
      if (open === s.open.has(id) || (open && !settledSet.has(id))) return s;
      const next = new Set(s.open);
      if (open) next.add(id); else next.delete(id);
      return { ...s, open: next };
    }),
  };
}
