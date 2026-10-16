import { GitBranchIcon } from 'lucide-react';
import { NativeSelect } from '@/components/ui/native-select';
import { Badge } from '@/components/ui/badge';
import { navigateTo, type Route } from '@/lib/route';
import * as storage from '@/lib/storage';
import { useCheckout, useProjects } from '@/state/checkout';
import { ErrorState } from '@/features/common/States';

export const rememberCheckout = (project: string, worktree: string | undefined) =>
  storage.setItem('lastCheckout', JSON.stringify({ project, worktree: worktree ?? null }));

export function CheckoutBar({ route, followingTitle, unfollowable }: { route: Route; followingTitle?: string; unfollowable?: boolean }) {
  const projects = useProjects();
  const checkout = useCheckout(route.project, route.worktree ?? null);
  const go = (project: string, worktree?: string) => { rememberCheckout(project, worktree); navigateTo({ project, worktree }); };
  const info = checkout.data?.checkout;
  return (
    <div className="flex flex-col gap-2 border-b p-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="cb-project">Project</label>
        <NativeSelect className="min-w-32 flex-1" id="cb-project" value={route.project ?? ''} onChange={(e) => e.target.value && go(e.target.value)}>
          {!route.project && <option value="">Choose a project…</option>}
          {route.project && !projects.data?.projects.some((p) => p.name === route.project) && <option value={route.project}>{route.project}</option>}
          {projects.data?.projects.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
        </NativeSelect>
        {route.project && (
          <>
            <label className="sr-only" htmlFor="cb-worktree">Worktree</label>
            <NativeSelect className="min-w-32 flex-1" id="cb-worktree" value={route.worktree ?? ''} onChange={(e) => go(route.project!, e.target.value || undefined)}>
              <option value="">Main checkout</option>
              {route.worktree && !checkout.data?.worktrees.some((w) => w.worktreeName === route.worktree) && <option value={route.worktree}>{route.worktree}</option>}
              {checkout.data?.worktrees.map((w) => <option key={w.worktreeName} value={w.worktreeName}>{w.worktreeName}</option>)}
            </NativeSelect>
          </>
        )}
      </div>
      {info && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <GitBranchIcon className="size-3.5" aria-hidden />
          <span>{info.branch ?? 'detached HEAD'}</span>
          {info.dirty && <Badge variant="warning">uncommitted changes</Badge>}
        </p>
      )}
      {followingTitle && <Badge variant="info" className="w-fit">following {followingTitle}</Badge>}
      {unfollowable && <p className="text-xs text-muted-foreground">Active session’s project isn’t reviewable here</p>}
      {(projects.error || checkout.error) ? <ErrorState error={projects.error ?? checkout.error} onRetry={() => { projects.reload(); checkout.reload(); }} /> : null}
    </div>
  );
}
