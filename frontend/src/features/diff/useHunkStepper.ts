import { useEffect, useRef, useState, type RefObject } from 'react';
import { toast } from 'sonner';
import type { Row } from '@/lib/diffRows';
import { useRoute } from '@/lib/route';
import type { DiffFile, TextHunk, Verdict } from '@/lib/types';
import { useShortcutHandler } from '@/state/shortcutRegistry';
import { useReviewCtx } from '@/state/reviewContext';
import { useReviewActions } from '@/state/threads';
import type { HunkStepper } from '@/features/nav/JumpBar';

/** Slack in px between a hunk's top and the header's bottom edge that still counts as "at the top". */
const SLOP = 2;

/** The hunk the view is at: the last whose top has reached `line` (the sticky header's bottom edge), else the first. `tops` ascend. */
export function hunkAt(tops: number[], line: number): number {
  let at = 0;
  tops.forEach((t, i) => { if (t <= line + SLOP) at = i; });
  return at;
}
/** The first hunk wholly below `line`; -1 when none. */
export const nextHunk = (tops: number[], line: number): number => tops.findIndex((t) => t > line + SLOP);
/** The last hunk that starts above `line`, so from the middle of a hunk this is its own start; -1 when none. */
export const prevHunk = (tops: number[], line: number): number => tops.findLastIndex((t) => t < line - SLOP);

/**
 * The hunk a step goes to, or -1 at an end. With a hunk holding focus (`active` ≥ 0) it steps by index, so it can never
 * bounce between hunks the page cannot scroll to the header; `k` first returns to the focused hunk's own start when
 * the view has scrolled past it. With none focused it reads the geometry.
 */
export function stepTarget(tops: number[], line: number, active: number, dir: 1 | -1): number {
  if (active < 0) return dir === 1 ? nextHunk(tops, line) : prevHunk(tops, line);
  if (dir === 1) return active < tops.length - 1 ? active + 1 : -1;
  if (tops[active] < line - SLOP) return active;
  return active > 0 ? active - 1 : -1;
}

const WORD: Record<Verdict, string> = { accepted: 'accepted', rejected: 'rejected', pending: 'cleared' };

/**
 * Hunk stepping (`j`/`k`), the "Hunk k of N" position, the hunk landing of `hunk=undecided`, and the verdict keys
 * (`a`/`x`/`0`) of the open file. The keys act only on the hunk that holds keyboard focus (see `focusedHunk`).
 * `rows`: the file's rows after collapsing; `limit`: the rendered window over them.
 */
export function useHunkStepper({ file, textFile, rows, limit, setLimit, headerRef, gridRef }: {
  file: DiffFile | null; textFile: boolean; rows: Row[]; limit: number; setLimit: (n: number) => void;
  headerRef: RefObject<HTMLElement | null>; gridRef: RefObject<HTMLElement | null>;
}): { hunk: HunkStepper | undefined; hunkIds: string[] } {
  const ctx = useReviewCtx();
  const route = useRoute();
  const actions = useReviewActions();
  const hunkIds = rows.flatMap((r) => (r.kind === 'hunk' && r.hunk.kind === 'text' ? [r.hunk.id] : []));
  const [pos, setPos] = useState({ k: 1, prev: false, next: false });
  const pending = useRef<string | null>(null);

  const tops = () => {
    const els = [...(gridRef.current?.querySelectorAll<HTMLElement>('[data-hunk-id]') ?? [])];
    // A hunk beyond the rendered window has no element yet: it counts as below everything.
    return hunkIds.map((id) => els.find((el) => el.dataset.hunkId === id)?.getBoundingClientRect().top ?? Infinity);
  };
  const line = () => headerRef.current?.getBoundingClientRect().bottom ?? 0;
  const activeIndex = () => {
    const id = document.activeElement?.closest<HTMLElement>('[data-hunk-id]')?.dataset.hunkId;
    return id ? hunkIds.indexOf(id) : -1;
  };

  const measure = () => {
    const t = tops(), l = line();
    const a = activeIndex();
    const next = { k: hunkAt(t, l) + 1, prev: stepTarget(t, l, a, -1) !== -1, next: stepTarget(t, l, a, 1) !== -1 };
    setPos((p) => (p.k === next.k && p.prev === next.prev && p.next === next.next ? p : next));
  };

  const reveal = (el: HTMLElement) => {
    el.style.scrollMarginTop = `${headerRef.current?.offsetHeight ?? 0}px`;
    el.scrollIntoView?.({ block: 'start' });
    el.focus({ preventScroll: true });
    measure();
  };
  const goTo = (i: number) => {
    const id = hunkIds[i];
    const el = [...(gridRef.current?.querySelectorAll<HTMLElement>('[data-hunk-id]') ?? [])].find((e) => e.dataset.hunkId === id);
    if (el) { reveal(el); return; }
    // Past the window: widen it, then `pending` is revealed once its block has rendered.
    const row = rows.findIndex((r) => r.kind === 'hunk' && r.hunk.id === id);
    pending.current = id;
    if (row >= limit) setLimit(row + 200);
  };
  useEffect(() => {
    if (!pending.current) return;
    const el = [...(gridRef.current?.querySelectorAll<HTMLElement>('[data-hunk-id]') ?? [])].find((e) => e.dataset.hunkId === pending.current);
    if (!el) return;
    pending.current = null;
    reveal(el);
  }, [limit, rows]);

  const step = (dir: 1 | -1) => {
    const t = tops(), l = line();
    const i = stepTarget(t, l, activeIndex(), dir);
    if (i === -1) return false;
    goTo(i);
  };

  // Position follows the scroll (passive, one measure per frame) and the layout (blocks collapse, the window widens).
  useEffect(() => {
    if (!textFile) return;
    const scroller: HTMLElement | Window = headerRef.current?.closest('main') ?? window;
    let frame = 0;
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; measure(); }); };
    const grid = gridRef.current;
    scroller.addEventListener('scroll', onScroll, { passive: true });
    grid?.addEventListener('focusin', onScroll);
    measure();
    return () => { scroller.removeEventListener('scroll', onScroll); grid?.removeEventListener('focusin', onScroll); if (frame) cancelAnimationFrame(frame); };
  }, [textFile, file?.path, hunkIds.join(), limit]);

  // `hunk=undecided` lands on the first pending hunk once per arrival; a routed thread or lines win. Not on the previous
  // fetch's data shown while the new one loads (`switching`): its verdicts may be stale.
  const landed = useRef<string | null>(null);
  useEffect(() => {
    if (route.hunk !== 'undecided') { landed.current = null; return; }
    if (!file || !textFile || ctx.fileDiff.switching || file.path !== route.file || route.thread || route.lines || landed.current === file.path) return;
    landed.current = file.path;
    const first = file.hunks.find((h): h is TextHunk => h.kind === 'text' && (!h.verdict || h.verdict === 'pending'));
    if (first) goTo(hunkIds.indexOf(first.id));
  }, [file?.path, route.file, route.hunk, route.thread, route.lines, textFile, ctx.fileDiff.switching]);

  useShortcutHandler('next-hunk', textFile && hunkIds.length ? () => step(1) : null);
  useShortcutHandler('prev-hunk', textFile && hunkIds.length ? () => step(-1) : null);

  // The verdict keys act on the focused hunk only. Focus inside a thread card does not count: after `n` the card holds
  // focus, and a letter typed there (meaning the reply box) must never decide a hunk.
  const focusedHunk = (): TextHunk | null => {
    const active = document.activeElement;
    if (!file || !active || active.closest('article') || !gridRef.current?.contains(active)) return null;
    const id = active.closest<HTMLElement>('[data-hunk-id]')?.dataset.hunkId;
    return file.hunks.find((h): h is TextHunk => h.kind === 'text' && h.id === id) ?? null;
  };
  const decide = (verdict: Verdict) => (e: KeyboardEvent) => {
    const hunk = focusedHunk();
    if (!hunk || !file) return false;
    const prev = hunk.verdict ?? 'pending';
    if (prev === verdict) return false;
    // A direct verdict clears every group it contradicts: refuse rather than silently undo a group decision.
    const group = ctx.guide?.groups.find((g) => g.verdict !== 'pending' && g.verdict !== verdict && g.hunks.some((h) => h.id === hunk.id));
    if (group) {
      toast(`Part of “${group.title}”, which is ${group.verdict} — change it from the hunk bar or the Guided tab`);
      return;
    }
    const path = file.path;
    void actions.setVerdict(path, hunk.id, verdict, hunk.verdict);
    toast(`Hunk ${WORD[verdict]}`, { action: { label: 'Undo', onClick: () => void actions.setVerdict(path, hunk.id, prev, verdict) } });
  };
  const verdicts = textFile && !ctx.readOnly && ctx.review.kind !== 'uncommitted';
  useShortcutHandler('accept-hunk', verdicts ? decide('accepted') : null);
  useShortcutHandler('reject-hunk', verdicts ? decide('rejected') : null);
  useShortcutHandler('clear-hunk', verdicts ? decide('pending') : null);

  return {
    hunk: textFile && hunkIds.length ? { k: pos.k, n: hunkIds.length, step, canStep: (dir) => (dir === 1 ? pos.next : pos.prev) } : undefined,
    hunkIds,
  };
}
