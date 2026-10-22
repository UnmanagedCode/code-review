/** A segmented button group's segment shape; the tint of the active one is the caller's (see `.wiki/gotchas/ui.md`). */
export const SEGMENT_SHAPE = 'rounded-none first:rounded-l-md last:rounded-r-md';
/** A segment whose active one carries the primary tint, keyed by `aria-pressed`. */
export const SEGMENT = `${SEGMENT_SHAPE} aria-pressed:bg-primary/15 aria-pressed:text-accent-foreground aria-pressed:hover:bg-primary/20 dark:aria-pressed:hover:bg-primary/20`;
