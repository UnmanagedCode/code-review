import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { Row } from '@/lib/diffRows';
import { extendSelection, lineOn, startSelection, type Selection } from '@/lib/selection';
import type { Side } from '@/lib/types';

export interface Cell { side: Side; n: number }

/** Line selection for the diff grid: mouse drag/shift-click, touch taps, keyboard. Disabled = never selects. */
export function useLineSelection(rows: Row[], enabled: boolean, resetKey: string) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [composing, setComposing] = useState(false);
  const [focus, setFocus] = useState<Cell | null>(null);
  const dragging = useRef(false);
  // The toolbar is held back while dragging: inserting it would shift the rows under the pointer.
  const [dragActive, setDragActive] = useState(false);
  const grid = useRef<HTMLDivElement>(null);
  const moveFocus = useRef(false);

  const clear = useCallback(() => { setSelection(null); setComposing(false); }, []);
  useEffect(() => { if (!enabled) clear(); }, [enabled, clear]);
  useEffect(() => {
    const up = () => { dragging.current = false; setDragActive(false); };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, []);
  // Another file (or review) invalidates the selection; expanding context does not.
  useEffect(() => { clear(); setFocus(null); }, [resetKey, clear]);

  useEffect(() => {
    if (!moveFocus.current || !focus) return;
    moveFocus.current = false;
    grid.current?.querySelector<HTMLElement>(`[data-cell="${focus.side}:${focus.n}"]`)?.focus();
  }, [focus]);

  const select = (next: Selection) => { setSelection(next); setComposing(false); };

  const onPointerDown = (side: Side, n: number) => (e: PointerEvent) => {
    if (!enabled || e.button > 0) return;
    setFocus({ side, n });
    if (e.pointerType === 'touch') {
      if (selection && selection.side === side) {
        if (n === selection.start || n === selection.end) { clear(); return; }
        select(extendSelection(rows, selection, n));
      } else select(startSelection(side, n));
      return;
    }
    dragging.current = true;
    setDragActive(true);
    if (e.shiftKey && selection?.side === side) select(extendSelection(rows, selection, n));
    else select(startSelection(side, n));
  };
  const onPointerEnter = (side: Side, n: number) => (e: PointerEvent) => {
    if (!enabled || !dragging.current || !(e.buttons & 1) || selection?.side !== side) return;
    select(extendSelection(rows, selection, n));
  };

  const onKeyDown = (side: Side, n: number) => (e: KeyboardEvent) => {
    if (!enabled) return;
    const idx = rows.findIndex((r) => lineOn(r, side) === n);
    const step = (dir: 1 | -1) => {
      for (let i = idx + dir; i >= 0 && i < rows.length; i += dir) {
        const m = lineOn(rows[i], side);
        if (m != null) return m;
      }
      return null;
    };
    const go = (cell: Cell) => { moveFocus.current = true; setFocus(cell); };
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        const m = step(e.key === 'ArrowDown' ? 1 : -1);
        e.preventDefault();
        if (m == null) return;
        if (e.shiftKey) {
          const base = selection?.side === side ? selection : startSelection(side, n);
          select(extendSelection(rows, base, m));
        }
        go({ side, n: m });
        return;
      }
      case 'ArrowLeft':
      case 'ArrowRight': {
        const to: Side = e.key === 'ArrowLeft' ? 'old' : 'new';
        e.preventDefault();
        const row = rows[idx];
        const m = row && lineOn(row, to);
        if (m != null && to !== side) go({ side: to, n: m });
        return;
      }
      case ' ':
      case 'Enter':
        e.preventDefault();
        select(startSelection(side, n));
        return;
      case 'c':
        if (selection) { e.preventDefault(); setComposing(true); }
        return;
      case 'Escape':
        clear();
        return;
    }
  };

  /** The roving tab stop: the focused cell while its line is still rendered, else the first selectable one. */
  const focusPresent = !!focus && rows.some((r) => lineOn(r, focus.side) === focus.n);
  const tabStop = (side: Side, n: number): boolean => {
    if (focus && focusPresent) return focus.side === side && focus.n === n;
    const firstRow = rows.find((r) => lineOn(r, 'new') != null || lineOn(r, 'old') != null);
    if (!firstRow) return false;
    const fs: Side = lineOn(firstRow, 'new') != null ? 'new' : 'old';
    return fs === side && lineOn(firstRow, fs) === n;
  };

  return { selection, dragging: dragActive, composing, clear, openComposer: () => setComposing(true), grid, onPointerDown, onPointerEnter, onKeyDown, tabStop };
}
