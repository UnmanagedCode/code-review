import type { ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { navigate, type Route } from '@/lib/route';
import { CheckoutBar } from '@/features/checkout/CheckoutBar';
import { Inbox } from '@/features/inbox/Inbox';
import { ReviewList } from '@/features/reviews/ReviewList';
import type { useFollowSession } from './useFollowSession';

/**
 * The side pane while no review is open: the Inbox and Checkout tabs. The tab is the route's `view` (`inbox`, absent = Checkout),
 * written with replace like the review pane's tab. The Checkout panel stays mounted (`hidden`) so the list's selects survive a
 * switch; the Inbox panel mounts only while shown, so it never fetches in the background.
 */
export function ListPane({ route, follow, placeholder }: { route: Route; follow: ReturnType<typeof useFollowSession>; placeholder?: ReactNode }) {
  const tab = route.view === 'inbox' ? 'inbox' : 'checkout';
  const choose = (v: string) => navigate({ view: v === 'inbox' ? 'inbox' : undefined }, { replace: true });
  return (
    <Tabs value={tab} onValueChange={choose} className="min-h-0 flex-1 gap-0">
      <TabsList aria-label="Review lists" className="mx-3 mt-2 mb-1 w-auto">
        <TabsTrigger value="inbox">Inbox</TabsTrigger>
        <TabsTrigger value="checkout">Checkout</TabsTrigger>
      </TabsList>
      <TabsContent value="inbox" className="flex min-h-0 flex-1 flex-col"><Inbox /></TabsContent>
      <TabsContent value="checkout" forceMount hidden={tab !== 'checkout'} className="flex min-h-0 flex-1 flex-col">
        <CheckoutBar route={route} {...follow} />
        {route.project ? <ReviewList project={route.project} worktree={route.worktree} /> : placeholder}
      </TabsContent>
    </Tabs>
  );
}
