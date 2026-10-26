import { Empty } from '@/features/common/States';
import { ListPane } from '@/features/layout/ListPane';
import { DesktopLayout, PhoneLayout } from '@/features/layout/layouts';
import { useFollowSession } from '@/features/layout/useFollowSession';
import { NewReviewDialog } from '@/features/picker/NewReviewDialog';
import { ReviewView } from '@/features/review/ReviewView';
import { navigate, useRoute } from '@/lib/route';
import { useMediaQuery, WIDE_QUERY } from '@/lib/useMediaQuery';

export function App() {
  const route = useRoute();
  const wide = useMediaQuery(WIDE_QUERY);
  const follow = useFollowSession(route);
  if (route.review) return <ReviewView key={route.review} id={route.review} />;

  const dialog = route.view === 'new' && route.project && (
    <NewReviewDialog project={route.project} worktree={route.worktree ?? null} onClose={() => navigate({ view: undefined })} />
  );
  if (!wide) {
    return <><PhoneLayout><ListPane route={route} follow={follow} placeholder={<Empty title="Choose a project to review" />} /></PhoneLayout>{dialog}</>;
  }
  const centre = <Empty title={route.project || route.view === 'inbox' ? 'Select a review' : 'Choose a project to review'} />;
  return <><DesktopLayout left={<ListPane route={route} follow={follow} />} center={centre} />{dialog}</>;
}
