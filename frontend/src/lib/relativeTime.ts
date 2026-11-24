const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]];
const fmt = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** "3 hours ago" for an ISO time. Display only: pass `now` to pin the clock. */
export function ago(iso: string, now = Date.now()): string {
  const seconds = Math.round((Date.parse(iso) - now) / 1000);
  for (const [unit, size] of UNITS) if (Math.abs(seconds) >= size) return fmt.format(Math.round(seconds / size), unit);
  return fmt.format(0, 'second');
}
