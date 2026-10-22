import { useId, type ReactNode } from 'react';
import { ResizeHandle } from './ResizeHandle';
import { useResizablePane } from './useResizablePane';

/** Desktop: a side pane on the left, resizable from its right edge, and the centre. */
export function DesktopLayout({ left, center }: { left: ReactNode; center: ReactNode }) {
  const pane = useResizablePane();
  const id = useId();
  return (
    <div ref={pane.rootRef} className="flex h-full min-h-0">
      {/* The handle is the scroller's sibling, so it never scrolls away with the pane's content. */}
      <div className="relative shrink-0" style={{ width: pane.width }}>
        <aside id={id} className="flex h-full flex-col overflow-y-auto border-r">{left}</aside>
        <ResizeHandle {...pane.handleProps} controls={id} />
      </div>
      {/* A stable scrollbar gutter keeps the centre's width (which picks the diff view) independent of its scrollbar. */}
      <main className="min-w-0 flex-1 overflow-auto [scrollbar-gutter:stable]">{center}</main>
    </div>
  );
}

/** Narrow (phone or a narrow docked pane): one pane at a time. */
export function PhoneLayout({ children }: { children: ReactNode }) {
  return <main className="flex h-full min-h-0 flex-col overflow-auto">{children}</main>;
}
