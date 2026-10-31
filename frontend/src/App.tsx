import { Empty } from '@/features/common/States';
import { ListPane } from '@/features/layout/ListPane';
import { DesktopLayout, PhoneLayout } from '@/features/layout/layouts';
import { useFollowSession } from '@/features/layout/useFollowSession';
import { useMenuTarget } from '@/features/layout/useMenuTarget';
import { NewReviewDialog } from '@/features/picker/NewReviewDialog';
import { ReviewView } from '@/features/review/ReviewView';
import { parsePrefill } from '@/lib/prefill';
import { navigate, NEW_REVIEW_CLOSED, useRoute } from '@/lib/route';
import { useMediaQuery, WIDE_QUERY } from '@/lib/useMediaQuery';

// cc's row menus arrive as `?ccProject=&ccWorktree=`; `useMenuTarget` turns them into a route.
export function App() {
  const route = useRoute();
  const wide = useMediaQuery(WIDE_QUERY);
  const menu = useMenuTarget();
  const follow = useFollowSession(route, menu.initial);
  if (route.review) return <ReviewView key={route.review} id={route.review} />;

  const dialog = route.view === 'new' && route.project && (
    // Keyed by its checkout and prefill: cc steering the open frame to another link remounts the dialog with the new prefill.
    <NewReviewDialog
      key={[route.project, route.worktree, route.range, route.sha].join('\0')} project={route.project} worktree={route.worktree ?? null}
      prefill={parsePrefill(route)} onClose={() => navigate(NEW_REVIEW_CLOSED)}
    />
  );
  if (!wide) {
    return <><PhoneLayout><ListPane route={route} follow={follow} arrival={menu.arrival} placeholder={<Empty title="Choose a project to review" />} /></PhoneLayout>{dialog}</>;
  }
  const centre = <Empty title={route.project || route.view === 'inbox' ? 'Select a review' : 'Choose a project to review'} />;
  return <><DesktopLayout left={<ListPane route={route} follow={follow} arrival={menu.arrival} />} center={centre} />{dialog}</>;
}
