import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { treeOrder } from '@/lib/fileTree';
import { LEAVE_FILE, navigate, useRoute } from '@/lib/route';
import { matchShortcut } from '@/lib/shortcuts';
import { nextNeedsYou, stepThread, walkOrder, type Slot } from '@/lib/threadWalk';
import { NEEDS_YOU } from '@/lib/threadState';
import type { ThreadDigest } from '@/lib/types';
import { useMediaQuery, WIDE_QUERY } from '@/lib/useMediaQuery';
import { dispatchShortcut, useShortcutHandler } from '@/state/shortcutRegistry';
import { useReviewCtx } from '@/state/reviewContext';
import { usePaneTab } from '@/features/review/paneTab';
import { threadPlace } from '@/features/threads/ThreadCard';
import { JumpNavContext, type JumpNav } from './jumpNavContext';
import { ShortcutsDialog } from './ShortcutsDialog';

const OFF_FILE = { lines: undefined, side: undefined, thread: undefined, hunk: undefined } as const;

/**
 * The review's keyboard navigation: owns the one `keydown` listener (`matchShortcut` → `dispatchShortcut`), the thread
 * and file walks, the `?` overlay, and the focus hand-off to the card a step routed to. The maths lives in `lib/threadWalk.ts`.
 */
export function JumpNavProvider({ children }: { children: ReactNode }) {
  const ctx = useReviewCtx();
  const route = useRoute();
  const paneTab = usePaneTab();
  const wide = useMediaQuery(WIDE_QUERY);
  const live = !ctx.pastView && !ctx.commit;
  const { placed, order } = useMemo(() => walkOrder(ctx.openThreads, ctx.files, ctx.guide), [ctx.openThreads, ctx.files, ctx.guide]);
  const sorted = useMemo(() => treeOrder(ctx.files), [ctx.files]);
  const [overlay, setOverlay] = useState(false);
  const last = useRef<Slot | null>(null);
  const focusRequest = useRef<{ id: string; diffOnly: boolean } | null>(null);

  const threadIndex = route.thread ? order.findIndex((t) => t.id === route.thread) : -1;
  const fileIndex = route.file ? sorted.findIndex((f) => f.path === route.file) : -1;
  // A request for a thread that never got routed must not fire on a later, unrelated arrival.
  useEffect(() => { if (focusRequest.current && route.thread !== focusRequest.current.id) focusRequest.current = null; }, [route.thread]);

  const goThread = (t: ThreadDigest, index: number) => {
    last.current = { id: t.id, index };
    focusRequest.current = { id: t.id, diffOnly: t.anchor.kind === 'lines' || t.anchor.kind === 'file' };
    const place = { ...threadPlace(t), hunk: undefined };
    // A review thread lives in the pane, which a phone never shows beside a file.
    const patch = !wide && t.anchor.kind === 'review' ? { ...LEAVE_FILE, ...place } : place;
    // Within one file Back should return to the previous file, not the previous thread.
    navigate(patch, { replace: t.anchor.kind !== 'review' && t.anchor.kind !== 'group' && t.anchor.file === route.file });
  };
  const peekThread = (dir: 1 | -1) => stepThread(order, route.thread, last.current, dir);
  const stepThreads = (dir: 1 | -1) => {
    const to = peekThread(dir);
    if (!to) return false;
    goThread(order[to.index], to.index);
  };
  const stepNeedsYou = () => {
    const t = nextNeedsYou(placed, route.thread);
    if (!t) { toast('No threads need you'); return; }
    goThread(t, order.findIndex((o) => o.id === t.id));
  };

  const peekFile = (dir: 1 | -1) => sorted[fileIndex === -1 ? (dir === 1 ? 0 : sorted.length - 1) : fileIndex + dir];
  const stepFiles = (dir: 1 | -1) => {
    const f = peekFile(dir);
    if (!f) return false;
    navigate({ file: f.path, ...OFF_FILE });
  };

  useShortcutHandler('next-thread', live ? () => stepThreads(1) : null);
  useShortcutHandler('prev-thread', live ? () => stepThreads(-1) : null);
  useShortcutHandler('next-needs-you', live ? stepNeedsYou : null);
  useShortcutHandler('next-file', () => stepFiles(1));
  useShortcutHandler('prev-file', () => stepFiles(-1));
  // On the Guided tab, leaving the file would show the step: the overview is `view=overview`, as the progress strip's link writes it.
  useShortcutHandler('overview', () => {
    if (paneTab === 'guided') { navigate({ ...LEAVE_FILE, view: 'overview' }); return true; }
    return route.file ? navigate(LEAVE_FILE) : false;
  });
  useShortcutHandler('shortcuts', () => setOverlay((o) => !o));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { const id = matchShortcut(e); if (id) dispatchShortcut(id, e); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const takeThreadFocus = useCallback((id: string, inDiff: boolean) => {
    const want = focusRequest.current;
    if (want?.id !== id || (want.diffOnly && !inDiff)) return false;
    focusRequest.current = null;
    return true;
  }, []);
  const value: JumpNav = {
    threads: {
      available: live, order, index: threadIndex, needsYou: order.filter((t) => t.state && NEEDS_YOU.includes(t.state)).length,
      step: stepThreads, canStep: (dir) => !!peekThread(dir),
    },
    files: { index: fileIndex, total: sorted.length, step: stepFiles, canStep: (dir) => !!peekFile(dir) },
    overlay: { open: overlay, setOpen: setOverlay },
    takeThreadFocus,
  };
  return (
    <JumpNavContext.Provider value={value}>
      {children}
      <ShortcutsDialog />
    </JumpNavContext.Provider>
  );
}
