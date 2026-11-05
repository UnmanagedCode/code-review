import { ArrowLeftIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LEAVE_FILE, navigate } from '@/lib/route';
import type { GuideView, RetiredGroup } from '@/lib/types';
import { ThreadCard } from '@/features/threads/ThreadCard';

/** A group that left the round: its title, why, and its threads (outdated, still repliable). Its verdict no longer counts. */
export function RetiredGroupView({ group, guide }: { group: RetiredGroup; guide: GuideView }) {
  const threads = guide.threads.filter((t) => t.anchor.kind === 'group' && t.anchor.groupId === group.id);
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate({ ...LEAVE_FILE, step: undefined })}><ArrowLeftIcon />Back to steps</Button>
      </div>
      <h2 className="break-words text-base font-semibold">{group.title}</h2>
      <p className="text-sm text-muted-foreground">
        Retired in round {group.retiredIn} ({group.reason === 'refresh' ? 'refresh' : 're-proposal'}) — its verdict no longer counts
      </p>
      {threads.length > 0 ? threads.map((t) => <ThreadCard key={t.id} thread={t} />) : <p className="text-sm text-muted-foreground">No threads on this group.</p>}
    </div>
  );
}
