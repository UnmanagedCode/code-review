import type { useResizablePanel } from './useResizablePanel';

type Props = ReturnType<typeof useResizablePanel>['handleProps'];

/** The thread panel column's separator on its left edge, dragged or moved with ←/→ (Shift: bigger steps), Home and End. */
export function ResizeHandle({ width, min, max, ...handlers }: Props) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize threads panel"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      tabIndex={0}
      {...handlers}
      className="absolute inset-y-0 left-0 z-10 w-2 cursor-col-resize touch-none select-none hover:bg-primary/20 focus-visible:bg-primary/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none pointer-coarse:w-4"
    />
  );
}
