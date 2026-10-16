const PREFIX = 'code-review:';

/** The only localStorage user; keys are prefixed so cc's own `code-conductor:*` keys are never touched. */
export function getItem(key: string): string | null {
  try { return localStorage.getItem(PREFIX + key); } catch { return null; }
}
export function setItem(key: string, value: string): void {
  try { localStorage.setItem(PREFIX + key, value); } catch { /* storage unavailable: the value is only a convenience */ }
}
