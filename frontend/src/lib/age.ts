const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A compact age for a list row: "just now", "12 min", "3 h", "2 d". Display only: pass `now` to pin the clock. */
export function ageLabel(iso: string, now = Date.now()): string {
  const ms = Math.max(0, now - Date.parse(iso));
  if (ms < MINUTE) return 'just now';
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)} h`;
  return `${Math.floor(ms / DAY)} d`;
}
