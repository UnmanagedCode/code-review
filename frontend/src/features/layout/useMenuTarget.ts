import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import * as ep from '@/lib/endpoints';
import { menuFailure, menuLanding } from '@/lib/menuTarget';
import { navigate, navigateTo, readMenuTarget, type MenuTarget } from '@/lib/route';

/**
 * Shows the checkout code-conductor's row ⋮ "Show reviews" names, on load and on cc's navigate (a popstate). Read-only:
 * one lookup and the inbox, nothing persisted. Every write replaces the history entry, so a reload or Back never repeats it.
 * `initial`: this load carried a target. `arrival` counts landings, so the list can reset its selects on each.
 */
export function useMenuTarget(): { initial: boolean; arrival: number } {
  const [initial] = useState(() => readMenuTarget());
  const [arrival, setArrival] = useState(0);

  useEffect(() => {
    let latest = 0;
    let live = true;
    const consume = (t: MenuTarget) => {
      // Strips cc's params before validating, keeping the page's own route (see `read` in lib/route.ts).
      navigate((r) => r, { replace: true });
      const seq = ++latest;
      // Any navigation while the requests are in flight (the user's, a link's) wins over the landing.
      const at = location.search;
      if (t.project === null) {
        toast.error(menuFailure(t));
        return;
      }
      Promise.all([ep.checkoutLookup(t.project, t.worktree), ep.inbox()]).then(([lookup, inbox]) => {
        if (!live || seq !== latest || location.search !== at) return;
        navigateTo(menuLanding(lookup.checkout, inbox.reviews), { replace: true });
        setArrival((n) => n + 1);
      }, (e: unknown) => {
        if (live && seq === latest) toast.error(menuFailure(t, e));
      });
    };
    if (initial) consume(initial);
    const onPop = () => {
      const t = readMenuTarget();
      if (t) consume(t);
    };
    window.addEventListener('popstate', onPop);
    return () => {
      live = false;
      window.removeEventListener('popstate', onPop);
    };
  }, [initial]);

  return { initial: initial !== null, arrival };
}
