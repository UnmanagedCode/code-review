import { useSyncExternalStore } from 'react';

/**
 * Unsent text (reply and new-comment drafts), session-local and keyed outside the component, so a draft survives its
 * form remounting: a card moving under a collapsed hunk, a composer re-keyed by a view flip.
 */
const drafts = new Map<string, unknown>();
const listeners = new Set<() => void>();

function publish() { listeners.forEach((l) => l()); }

export function setDraft(key: string, value: unknown): void { drafts.set(key, value); publish(); }
export function clearDraft(key: string): void { if (drafts.delete(key)) publish(); }
export function resetDrafts(): void { drafts.clear(); publish(); }

const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

/** `[value, set]` for the draft at `key`, `initial` until one is set. Re-renders only when that key's draft changes. */
export function useDraft<T>(key: string, initial: T): [T, (value: T) => void] {
  const value = useSyncExternalStore(subscribe, () => drafts.get(key));
  return [value === undefined ? initial : (value as T), (v) => setDraft(key, v)];
}
