import { useId, type ReactNode, type Ref } from 'react';

/** A titled overview section. `headingRef` lets the page move focus to the heading. */
export function Card({ title, count, headingRef, children }: { title: string; count?: number; headingRef?: Ref<HTMLHeadingElement>; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-3 text-card-foreground">
      <h3 id={id} ref={headingRef} tabIndex={-1} className="text-sm font-semibold outline-none">
        {title}{count !== undefined && <span className="ml-1.5 font-normal text-muted-foreground">{count}</span>}
      </h3>
      {children}
    </section>
  );
}
