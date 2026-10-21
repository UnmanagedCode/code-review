import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { clampPanel, KEY_BIG_STEP_PX, KEY_STEP_PX, PANEL_MIN_PX, parseWidth } from '@/lib/panelWidth';
import * as storage from '@/lib/storage';
import { useWidthObserver } from '@/lib/useWidthObserver';

const KEY = 'threadPanelWidth';

/**
 * The right column's width: the user's stored choice, clamped (on render only) to the room the layout leaves it,
 * so a narrower window narrows the panel without forgetting the choice. Attach `rootRef` to the layout and `leftRef`
 * to its left column; spread `handleProps` on the column's resize handle.
 */
export function useResizablePanel() {
  const [stored, setStored] = useState(() => parseWidth(storage.getItem(KEY)));
  const [room, setRoom] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ startX: number; startWidth: number; live: number } | null>(null);
  const left = useRef<Element | null>(null);
  const rootRef = useWidthObserver((w) => setRoom(w - (left.current?.getBoundingClientRect().width ?? 0)));
  const leftRef = useCallback((el: Element | null) => { left.current = el; }, []);

  const width = clampPanel(drag ? drag.live : stored, room);
  const max = clampPanel(Infinity, room);
  const commit = (want: number) => {
    const w = clampPanel(want, room);
    setStored(w);
    storage.setItem(KEY, String(w));
  };

  const handleProps = {
    width, min: PANEL_MIN_PX, max,
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      setDrag({ startX: e.clientX, startWidth: width, live: width });
    },
    // The handle sits on the panel's left edge: moving left widens it.
    onPointerMove: (e: PointerEvent<HTMLElement>) => { if (drag) setDrag({ ...drag, live: drag.startWidth + (drag.startX - e.clientX) }); },
    // A press without movement stores nothing: committing would overwrite the stored width with the clamped one.
    onPointerUp: () => { if (!drag) return; if (drag.live !== drag.startWidth) commit(drag.live); setDrag(null); },
    // A cancelled drag reverts and stores nothing.
    onPointerCancel: () => setDrag(null),
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      const step = e.shiftKey ? KEY_BIG_STEP_PX : KEY_STEP_PX;
      const next = { ArrowLeft: width + step, ArrowRight: width - step, Home: PANEL_MIN_PX, End: max }[e.key];
      if (next === undefined) return;
      e.preventDefault();
      commit(next);
    },
  };
  return { rootRef, leftRef, width, handleProps };
}
