import { afterEach, expect, test } from 'vitest';
import { GRID_KEYS, matchShortcut, SHORTCUTS } from './shortcuts';

function press(key: string, target: Element = document.body, init: KeyboardEventInit = {}): KeyboardEvent {
  let seen: KeyboardEvent | undefined;
  const on = (e: Event) => { seen = e as KeyboardEvent; };
  target.addEventListener('keydown', on);
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  target.removeEventListener('keydown', on);
  return seen!;
}
const el = (html: string) => { document.body.innerHTML = html; return document.body.firstElementChild!.querySelector('[data-t]') ?? document.body.firstElementChild!; };
afterEach(() => { document.body.innerHTML = ''; });

// Invariant: a bare letter or symbol of the catalog matches its shortcut anywhere on the page.
test('catalog keys match on a plain target', () => {
  for (const s of SHORTCUTS) expect(matchShortcut(press(s.keys, document.body, { shiftKey: s.keys === '?' })), s.keys).toBe(s.id);
  expect(matchShortcut(press('z'))).toBeNull();
});

// Invariant: no shortcut fires while the user types or drives a control or modal that owns letters.
test('no shortcut fires from a text field, textarea, contenteditable, select, dialog, menu or listbox, with Ctrl/Meta/Alt, or during IME composition', () => {
  const owners = [
    '<input data-t />', '<textarea data-t></textarea>', '<div contenteditable="true" data-t></div>', '<select data-t><option>a</option></select>',
    '<div role="dialog"><button data-t>x</button></div>', '<div role="alertdialog"><button data-t>x</button></div>',
    '<div role="menu"><div role="menuitem" data-t>x</div></div>', '<div role="listbox"><div role="option" data-t>x</div></div>',
  ];
  for (const html of owners) expect(matchShortcut(press('n', el(html))), html).toBeNull();
  // A button outside any of them does not own letters.
  expect(matchShortcut(press('n', el('<button data-t>x</button>')))).toBe('next-thread');
  // happy-dom answers getModifierState('AltGraph') with altKey; a real plain Alt is not AltGr.
  for (const mod of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
    const e = new KeyboardEvent('keydown', { key: 'n', ...mod });
    e.getModifierState = () => false;
    expect(matchShortcut(e), JSON.stringify(mod)).toBeNull();
  }
  expect(matchShortcut(press('n', document.body, { isComposing: true }))).toBeNull();
  // A key some earlier handler already took (a control's own key handling) is not ours.
  const handled = new KeyboardEvent('keydown', { key: 'n', cancelable: true });
  handled.preventDefault();
  expect(matchShortcut(handled)).toBeNull();
});

// Invariant: a held key repeats only for hunk stepping; every other shortcut acts once per press.
test('key repeat is ignored for every shortcut except j and k', () => {
  for (const s of SHORTCUTS) {
    const e = new KeyboardEvent('keydown', { key: s.keys, repeat: true, shiftKey: s.keys === '?' });
    expect(matchShortcut(e), s.keys).toBe(s.id === 'next-hunk' || s.id === 'prev-hunk' ? s.id : null);
  }
});

// Invariant: layouts that type `[`, `]` and `/` with AltGr still get those shortcuts.
test('AltGr-typed [ ] / still match', () => {
  const altGr = (key: string) => { const e = new KeyboardEvent('keydown', { key, ctrlKey: true, altKey: true }); e.getModifierState = (m) => m === 'AltGraph'; return e; };
  expect(matchShortcut(altGr('['))).toBe('prev-file');
  expect(matchShortcut(altGr(']'))).toBe('next-file');
  expect(matchShortcut(altGr('/'))).toBe('focus-file-filter');
});

// Invariant: no two shortcuts share a key, and none shadows a line-selection key of the diff grid.
test('catalog keys are unique and disjoint from the diff grid keys', () => {
  const keys = SHORTCUTS.map((s) => s.keys);
  expect(new Set(keys).size).toBe(keys.length);
  expect(new Set(SHORTCUTS.map((s) => s.id)).size).toBe(SHORTCUTS.length);
  const grid = GRID_KEYS.flatMap((g) => g.keys.split(/[ /+]+/));
  for (const k of keys) expect(grid, k).not.toContain(k);
});
