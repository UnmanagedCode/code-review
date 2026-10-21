import type { ReactNode } from 'react';
import { ResizeHandle } from './ResizeHandle';
import { useResizablePanel } from './useResizablePanel';

/** Desktop: a left column, the centre, and (≥ xl) an optional right column, resizable from its left edge. */
export function DesktopLayout({ left, center, right }: { left: ReactNode; center: ReactNode; right?: ReactNode }) {
  const panel = useResizablePanel();
  return (
    <div ref={right ? panel.rootRef : undefined} className="flex h-full min-h-0">
      <aside ref={panel.leftRef} className="flex w-80 shrink-0 flex-col overflow-y-auto border-r xl:w-96">{left}</aside>
      <main className="min-w-0 flex-1 overflow-auto">{center}</main>
      {right && (
        <aside className="relative flex shrink-0 flex-col overflow-hidden border-l" style={{ width: panel.width }}>
          <ResizeHandle {...panel.handleProps} />
          {right}
        </aside>
      )}
    </div>
  );
}

/** Narrow (phone or a narrow docked pane): one pane at a time. */
export function PhoneLayout({ children }: { children: ReactNode }) {
  return <main className="flex h-full min-h-0 flex-col overflow-auto">{children}</main>;
}
