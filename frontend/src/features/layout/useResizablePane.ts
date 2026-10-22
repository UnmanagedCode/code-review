import { useState, type KeyboardEvent, type PointerEvent } from 'react';
import { clampPane, KEY_BIG_STEP_PX, KEY_STEP_PX, PANE_MIN_PX, parseWidth } from '@/lib/paneWidth';
import * as storage from '@/lib/storage';
import { useWidthObserver } from '@/lib/useWidthObserver';

const KEY = 'sidePaneWidth';

/**
 * The side pane's width: the user's stored choice, clamped (on render only) to the room the layout has, so a narrower
 * window narrows the pane without forgetting the choice. Attach `rootRef` to the layout; spread `handleProps` on the
 * pane's resize handle.
 */
export function useResizablePane() {
  const [stored, setStored] = useState(() => parseWidth(storage.getItem(KEY)));
  const [room, setRoom] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ startX: number; startWidth: number; live: number } | null>(null);
  const rootRef = useWidthObserver(setRoom);

  const width = clampPane(drag ? drag.live : stored, room);
  const max = clampPane(Infinity, room);
  const commit = (want: number) => {
    const w = clampPane(want, room);
    setStored(w);
    storage.setItem(KEY, String(w));
  };

  const handleProps = {
    width, min: PANE_MIN_PX, max,
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      setDrag({ startX: e.clientX, startWidth: width, live: width });
    },
    // The handle sits on the pane's right edge: moving right widens it.
    onPointerMove: (e: PointerEvent<HTMLElement>) => { if (drag) setDrag({ ...drag, live: drag.startWidth + (e.clientX - drag.startX) }); },
    // A press without movement stores nothing: committing would overwrite the stored width with the clamped one.
    onPointerUp: () => { if (!drag) return; if (drag.live !== drag.startWidth) commit(drag.live); setDrag(null); },
    // A cancelled drag reverts and stores nothing.
    onPointerCancel: () => setDrag(null),
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      const step = e.shiftKey ? KEY_BIG_STEP_PX : KEY_STEP_PX;
      const next = { ArrowRight: width + step, ArrowLeft: width - step, Home: PANE_MIN_PX, End: max }[e.key];
      if (next === undefined) return;
      e.preventDefault();
      commit(next);
    },
  };
  return { rootRef, width, handleProps };
}
