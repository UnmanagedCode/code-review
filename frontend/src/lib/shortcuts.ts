import { isTextEntry } from './textEntry';

export type ShortcutGroup = 'Threads' | 'Hunks' | 'Files' | 'Review';

export const SHORTCUT_IDS = [
  'next-thread', 'prev-thread', 'next-needs-you', 'next-file', 'prev-file', 'next-hunk', 'prev-hunk', 'accept-hunk', 'reject-hunk', 'clear-hunk',
  'toggle-viewed', 'focus-file-filter', 'overview', 'submit-round', 'shortcuts',
] as const;
export type ShortcutId = (typeof SHORTCUT_IDS)[number];

export interface Shortcut { id: ShortcutId; keys: string; label: string; group: ShortcutGroup }

/** The one catalog of global shortcuts: the key listener, the `?` overlay and the button tooltips all read it. */
export const SHORTCUTS: readonly Shortcut[] = [
  { id: 'next-thread', keys: 'n', label: 'Next open thread', group: 'Threads' },
  { id: 'prev-thread', keys: 'p', label: 'Previous open thread', group: 'Threads' },
  { id: 'next-needs-you', keys: 'u', label: 'Next thread that needs you', group: 'Threads' },
  { id: 'next-hunk', keys: 'j', label: 'Next hunk', group: 'Hunks' },
  { id: 'prev-hunk', keys: 'k', label: 'Previous hunk', group: 'Hunks' },
  { id: 'accept-hunk', keys: 'a', label: 'Accept the focused hunk', group: 'Hunks' },
  { id: 'reject-hunk', keys: 'x', label: 'Reject the focused hunk', group: 'Hunks' },
  { id: 'clear-hunk', keys: '0', label: 'Clear the focused hunk’s verdict', group: 'Hunks' },
  { id: 'next-file', keys: ']', label: 'Next file', group: 'Files' },
  { id: 'prev-file', keys: '[', label: 'Previous file', group: 'Files' },
  { id: 'toggle-viewed', keys: 'v', label: 'Mark the file viewed', group: 'Files' },
  { id: 'focus-file-filter', keys: '/', label: 'Filter files', group: 'Files' },
  { id: 'overview', keys: 'o', label: 'Overview', group: 'Review' },
  { id: 'submit-round', keys: 's', label: 'Submit round', group: 'Review' },
  { id: 'shortcuts', keys: '?', label: 'Keyboard shortcuts', group: 'Review' },
];

/** The line-selection keys `useLineSelection` handles inside the diff grid. Documentation only: shown in the overlay, never matched here. */
export const GRID_KEYS: readonly { keys: string; label: string }[] = [
  { keys: '↑ ↓', label: 'Move the line selection' },
  { keys: '← →', label: 'Switch between the old and new side' },
  { keys: 'Shift+↑ ↓', label: 'Extend the selection' },
  { keys: 'Space / Enter', label: 'Select the focused line' },
  { keys: 'c', label: 'Comment on the selection' },
  { keys: 'Esc', label: 'Clear the selection' },
];

const BY_KEY = new Map(SHORTCUTS.map((s) => [s.keys, s.id]));
const OWN_KEYS = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/** The key label for `id`, for a tooltip. */
export const keysOf = (id: ShortcutId): string => SHORTCUTS.find((s) => s.id === id)!.keys;

/**
 * The shortcut a keydown asks for, or null. Never while the user types or drives a control that owns letters: a text
 * field, a native select (type-ahead), or anything inside a dialog, menu or listbox (they own their keys).
 */
export function matchShortcut(e: KeyboardEvent): ShortcutId | null {
  if (e.defaultPrevented || e.isComposing) return null;
  // AltGr reports Ctrl+Alt on some platforms and types `[`, `]` and `/` on many layouts.
  const altGr = e.getModifierState?.('AltGraph') ?? false;
  if (!altGr && (e.ctrlKey || e.metaKey || e.altKey)) return null;
  const t = e.target instanceof Element ? e.target : null;
  if (t && (isTextEntry(t) || t.tagName === 'SELECT' || t.closest(OWN_KEYS))) return null;
  return BY_KEY.get(e.key) ?? null;
}
