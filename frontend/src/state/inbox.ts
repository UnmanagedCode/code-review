import { toast } from 'sonner';
import * as ep from '@/lib/endpoints';
import { errorText } from '@/lib/refusals';
import { useSseReload } from './live';
import { useFetch } from './useFetch';

/** Every open review, latest activity first. Any review event refetches it. */
export function useInbox() {
  const inbox = useFetch(ep.inbox, []);
  useSseReload(inbox.reload, () => true);
  return inbox;
}

/** Closes a review from the inbox, then calls `reload`; a refusal toasts. */
export function useCloseReview(reload: () => void) {
  return async (id: string) => {
    try {
      await ep.patchReview(id, { status: 'closed' });
      reload();
    } catch (e) {
      toast.error(errorText(e));
    }
  };
}
