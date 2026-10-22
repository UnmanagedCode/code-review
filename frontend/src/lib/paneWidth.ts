/** The side pane (left column of every wide layout): its default, bounds, and the diff width it always leaves while room allows. */
export const PANE_DEFAULT_PX = 384; // w-96
export const PANE_MIN_PX = 288; // 18rem: the pane's tab list and a thread card's action row fit
export const PANE_MAX_PX = 640; // 40rem
export const DIFF_MIN_PX = 384; // 24rem
export const KEY_STEP_PX = 16;
export const KEY_BIG_STEP_PX = 64;

/** `room` = width shared by the pane and the diff (the layout's width), null before measurement. */
export function clampPane(want: number, room: number | null): number {
  const max = room == null ? PANE_MAX_PX : Math.max(PANE_MIN_PX, Math.min(PANE_MAX_PX, room - DIFF_MIN_PX));
  return Math.round(Math.min(max, Math.max(PANE_MIN_PX, want)));
}

/** A stored width, or the default when absent or not a finite number. */
export function parseWidth(raw: string | null): number {
  const n = raw == null || raw.trim() === '' ? NaN : Number(raw);
  return Number.isFinite(n) ? n : PANE_DEFAULT_PX;
}
