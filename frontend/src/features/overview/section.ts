/**
 * A request to land on one section of the overview (the strip's "k undecided" link asks for `hunks`). The overview takes it
 * when it mounts, or at once when it is already on screen.
 */
export type Section = 'hunks';
let pending: Section | null = null;
const listeners = new Set<() => void>();

export function requestSection(section: Section): void {
  pending = section;
  listeners.forEach((l) => l());
}
/** Returns and clears the pending request. */
export function takeSection(): Section | null {
  const s = pending;
  pending = null;
  return s;
}
export function onSectionRequest(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
