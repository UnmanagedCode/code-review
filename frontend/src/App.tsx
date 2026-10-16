import { CheckoutBar } from '@/features/checkout/CheckoutBar';
import { Empty } from '@/features/common/States';
import { DesktopLayout, PhoneLayout } from '@/features/layout/layouts';
import { useFollowSession } from '@/features/layout/useFollowSession';
import { NewReviewDialog } from '@/features/picker/NewReviewDialog';
import { ReviewView } from '@/features/review/ReviewView';
import { ReviewList } from '@/features/reviews/ReviewList';
import { navigate, useRoute } from '@/lib/route';
import { useMediaQuery, WIDE_QUERY } from '@/lib/useMediaQuery';

export function App() {
  const route = useRoute();
  const wide = useMediaQuery(WIDE_QUERY);
  const follow = useFollowSession(route);
  if (route.review) return <ReviewView id={route.review} />;

  const left = (
    <>
      <CheckoutBar route={route} {...follow} />
      {route.project && <ReviewList project={route.project} worktree={route.worktree} />}
    </>
  );
  const dialog = route.view === 'new' && route.project && (
    <NewReviewDialog project={route.project} worktree={route.worktree ?? null} onClose={() => navigate({ view: undefined })} />
  );
  const centre = <Empty title={route.project ? 'Select a review' : 'Choose a project to review'} />;
  return wide
    ? <><DesktopLayout left={left} center={centre} />{dialog}</>
    : <><PhoneLayout>{route.project ? left : <>{left}{centre}</>}</PhoneLayout>{dialog}</>;
}
