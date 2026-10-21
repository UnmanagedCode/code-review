import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Thread } from '@/lib/types';
import { KindBadge } from '@/features/threads/KindBadge';
import { ThreadCard } from '@/features/threads/ThreadCard';

const firstLine = (t: Thread) => (t.messages[0]?.body ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? '';

/**
 * A thread in the diff. When `toggleable` (resolved) it gets a one-line summary that discloses the card.
 * Every thread renders through here so its card keeps the same place in the tree as it resolves, and stays
 * mounted (hidden) while collapsed: a reply draft survives both.
 */
export function SettledThread({ thread, collapsed, toggleable, onToggle, note }: { thread: Thread; collapsed: boolean; toggleable: boolean; onToggle: (open: boolean) => void; note?: ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      {toggleable && (
        <Button variant="ghost" size="sm" aria-expanded={!collapsed} aria-controls={id} className="h-auto w-full min-w-0 justify-start gap-1.5 rounded-md border bg-card px-3 py-1.5 font-normal" onClick={() => onToggle(collapsed)}>
          {collapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
          <KindBadge kind={thread.kind} severity={thread.severity} />
          <span className="min-w-0 flex-1 truncate text-left">{firstLine(thread)}</span>
          <Badge variant="secondary">resolved</Badge>
          {thread.disposition && <Badge variant="success">{thread.disposition}</Badge>}
        </Button>
      )}
      <div id={id} hidden={collapsed}><ThreadCard thread={thread} note={note} /></div>
    </div>
  );
}
