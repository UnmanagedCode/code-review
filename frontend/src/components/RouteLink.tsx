import type { ComponentProps } from 'react';
import { navigate, toSearch, useRoute, type Route } from '@/lib/route';

/** An in-app link: the href comes from the route serialiser, the click navigates without a page load. */
export function RouteLink({ to, replace, onClick, ...props }: Omit<ComponentProps<'a'>, 'href'> & { to: Route | ((current: Route) => Route); replace?: boolean }) {
  const current = useRoute();
  const target = typeof to === 'function' ? to(current) : { ...current, ...to };
  return (
    <a
      {...props}
      href={toSearch(target)}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        navigate(() => target, { replace });
      }}
    />
  );
}
