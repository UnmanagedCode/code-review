import type { FileFilter } from '@/state/fileFilter';
import type { FileState } from './types';

/** True when any part of the filter is on. */
export const isFiltered = (f: FileFilter): boolean => f.text.trim() !== '' || f.needsMe || f.undecided;

/** A file with a verdict still to give (an uncommitted review has none). */
export const undecidedFile = (f: FileState): boolean => (f.verdicts?.pending ?? 0) > 0;

/**
 * The files a filter keeps, in the order given: the text (a case-insensitive substring of the path) AND the toggles,
 * which are OR'd with each other when both are on. `needsYou`: open threads waiting on the human, per path.
 */
export function filterFiles(files: FileState[], filter: FileFilter, needsYou: ReadonlyMap<string, number>): FileState[] {
  const text = filter.text.trim().toLowerCase();
  return files.filter((f) => {
    if (text && !f.path.toLowerCase().includes(text)) return false;
    if (!filter.needsMe && !filter.undecided) return true;
    return (filter.needsMe && (needsYou.get(f.path) ?? 0) > 0) || (filter.undecided && undecidedFile(f));
  });
}
