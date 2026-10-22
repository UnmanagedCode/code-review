import { Badge } from '@/components/ui/badge';
import type { Author } from '@/lib/types';
import { useReviewCtx } from '@/state/reviewContext';

export function AuthorBadge({ author }: { author: Author }) {
  const { sessions } = useReviewCtx();
  if (author.kind === 'human') return <Badge variant="secondary">You</Badge>;
  const session = sessions.find((s) => s.sessionId === author.sessionId);
  const variant = author.role === 'author' ? 'success' : author.role === 'conductor' ? 'plan' : 'info';
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge variant={variant}>{author.role}</Badge>
      <span className="text-xs text-muted-foreground">{session?.label || author.sessionId.slice(0, 8)}</span>
    </span>
  );
}
