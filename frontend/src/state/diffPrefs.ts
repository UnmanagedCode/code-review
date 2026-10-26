import { useSyncExternalStore } from 'react';
import { GIT_CONTEXT_LINES } from '@/lib/gitContext';
import * as storage from '@/lib/storage';

/** The Context lines choices; the default is what git sends. */
export const CONTEXT_CHOICES = [0, 1, 3, 5, 10, 25];
export const DEFAULT_CONTEXT = GIT_CONTEXT_LINES;
const CONTEXT_KEY = 'diffContext';
const WS_KEY = 'ignoreWhitespace';

export interface DiffPrefs { context: number; ignoreWhitespace: boolean }

// Held in memory (read from storage once), so the options still work where storage is unavailable.
let prefs: DiffPrefs | null = null;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

function load(): DiffPrefs {
  const stored = storage.getItem(CONTEXT_KEY);
  const context = stored !== null && /^\d+$/.test(stored) && CONTEXT_CHOICES.includes(Number(stored)) ? Number(stored) : DEFAULT_CONTEXT;
  return { context, ignoreWhitespace: storage.getItem(WS_KEY) === '1' };
}
const snapshot = () => (prefs ??= load());

export function setDiffPrefs(p: Partial<DiffPrefs>): void {
  prefs = { ...snapshot(), ...p };
  if (p.context !== undefined) storage.setItem(CONTEXT_KEY, String(p.context));
  if (p.ignoreWhitespace !== undefined) storage.setItem(WS_KEY, p.ignoreWhitespace ? '1' : '0');
  listeners.forEach((l) => l());
}

/** Forget the in-memory copy: the next read comes from storage again. */
export function resetDiffPrefs(): void { prefs = null; listeners.forEach((l) => l()); }

/** Display-only diff options, global to this browser and remembered in it. */
export function useDiffPrefs(): DiffPrefs & { setPrefs: (p: Partial<DiffPrefs>) => void } {
  return { ...useSyncExternalStore(subscribe, snapshot), setPrefs: setDiffPrefs };
}
