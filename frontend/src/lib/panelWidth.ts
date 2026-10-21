/** Thread panel column (≥ xl): its default, bounds, and the diff width it always leaves while room allows. */
export const PANEL_DEFAULT_PX = 384; // w-96
export const PANEL_MIN_PX = 288; // 18rem: the tab list and a card's action row fit
export const PANEL_MAX_PX = 640; // 40rem
export const DIFF_MIN_PX = 384; // 24rem
export const KEY_STEP_PX = 16;
export const KEY_BIG_STEP_PX = 64;

/** `room` = width shared by diff and panel (layout width − left column), null before measurement. */
export function clampPanel(want: number, room: number | null): number {
  const max = room == null ? PANEL_MAX_PX : Math.max(PANEL_MIN_PX, Math.min(PANEL_MAX_PX, room - DIFF_MIN_PX));
  return Math.round(Math.min(max, Math.max(PANEL_MIN_PX, want)));
}

/** A stored width, or the default when absent or not a finite number. */
export function parseWidth(raw: string | null): number {
  const n = raw == null || raw.trim() === '' ? NaN : Number(raw);
  return Number.isFinite(n) ? n : PANEL_DEFAULT_PX;
}
