import type { DiffFile } from './types';

/** Line numbers up to this many digits fit the stock gutter beside the hover `+` chip (`Gutter`); more widen it. */
const STOCK_DIGITS = 3;

/**
 * The gutter width for a file whose line numbers need more than the stock gutter, as a CSS length (`ch` is the diff's
 * monospace digit); undefined keeps the stock width. It follows the widest number on either side the file can show, so it
 * is fixed for the file: expanding gaps, scrolling and hovering never move it. The extra room is the hover `+` chip
 * (16px and a 2px gap; the compact chip of the wrapped, narrow layout is 10px) and the cell's side padding.
 */
export function gutterWidth(file: DiffFile, wrap: boolean): string | undefined {
  let widest = Math.max(file.lineCount.old ?? 0, file.lineCount.new ?? 0);
  for (const h of file.hunks) if (h.kind === 'text') widest = Math.max(widest, h.oldStart + h.oldLines - 1, h.newStart + h.newLines - 1);
  const digits = String(widest).length;
  if (digits <= STOCK_DIGITS) return undefined;
  return wrap ? `calc(${digits}ch + 16px)` : `calc(${digits}ch + 1.5rem)`;
}
