import type { useResizablePane } from './useResizablePane';

type Props = ReturnType<typeof useResizablePane>['handleProps'] & { controls: string };

/** The side pane's separator on its right edge, dragged or moved with ←/→ (Shift: bigger steps), Home and End. */
export function ResizeHandle({ width, min, max, controls, ...handlers }: Props) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize side pane"
      aria-controls={controls}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      tabIndex={0}
      {...handlers}
      className="absolute inset-y-0 right-0 z-10 w-2 cursor-col-resize touch-none select-none hover:bg-primary/20 focus-visible:bg-primary/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none pointer-coarse:w-4"
    />
  );
}
