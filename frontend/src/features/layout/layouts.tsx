import type { ReactNode } from 'react';

/** Desktop: a left column, the centre, and (≥ xl) an optional right column. */
export function DesktopLayout({ left, center, right }: { left: ReactNode; center: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-r xl:w-96">{left}</aside>
      <main className="min-w-0 flex-1 overflow-auto">{center}</main>
      {right && <aside className="flex w-96 shrink-0 flex-col overflow-hidden border-l">{right}</aside>}
    </div>
  );
}

/** Narrow (phone or a narrow docked pane): one pane at a time. */
export function PhoneLayout({ children }: { children: ReactNode }) {
  return <main className="flex h-full min-h-0 flex-col overflow-auto">{children}</main>;
}
