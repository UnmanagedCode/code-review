import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { buildRows, gapHolding, gapSpans, type Expansions, type Row } from '@/lib/diffRows';
import * as ep from '@/lib/endpoints';
import { errorText } from '@/lib/refusals';
import type { DiffFile, Side, Thread, Verdict } from '@/lib/types';
import { clearReturned, recordDropped } from './dropped';
import { useFetch } from './useFetch';

export const EXPAND_STEP = 20;

export interface FileDiffOptions {
  reviewId: string;
  path: string | undefined;
  /** The review's load counter: when it moves, the open file is refetched. */
  version: number;
  uncommitted: boolean;
  /** Commit-filter view: the file comes from this list and is read-only (no context expansion). */
  commitFiles?: DiffFile[];
  /** Past-round view of a range review: the file and its expandable context are read from that round. */
  round?: number;
  /**
   * Comparison of two rounds: the file comes from `files` (undefined while loading). Its old side is round `from`'s head
   * and its new side round `to`'s, so context is read from a round's head: `to`'s, or `from`'s for a file deleted there.
   * `reload` refetches the comparison: the file has no fetch of its own.
   */
  compare?: { from: number; to: number; files: DiffFile[] | undefined; error?: unknown; reload: () => void };
}

/** The open file's hunks and threads, its expandable context, and the local patches for mutation responses. */
export function useFileDiff({ reviewId, path, version, uncommitted, commitFiles, round, compare }: FileDiffOptions) {
  const commitMode = !!commitFiles;
  const listed = commitMode || !!compare;
  const fetched = useFetch(
    path && !listed ? async () => (await (round ? ep.roundDiff(reviewId, round, path) : ep.diff(reviewId, path))).files[0] : null,
    [reviewId, path, listed, round],
  );
  const lastVersion = useRef(version);
  useEffect(() => {
    if (lastVersion.current !== version) { lastVersion.current = version; fetched.reload(); }
  }, [version]);

  const file: DiffFile | undefined = commitMode ? commitFiles.find((f) => f.path === path)
    : compare ? compare.files?.find((f) => f.path === path) : fetched.data;
  const side: Side = file?.status === 'deleted' ? 'old' : 'new';
  // Where gap lines are read: gap lines are the same on both sides, so a comparison reads a round's head.
  const source: { side: Side; round?: number } = compare ? { side: 'new', round: side === 'new' ? compare.to : compare.from } : { side, round };

  const [expansions, setExpansions] = useState<Expansions>({});
  const [texts, setTexts] = useState<Record<number, string>>({});
  const [total, setTotal] = useState<number | null>(null);
  const textsRef = useRef(texts);
  textsRef.current = texts;
  useEffect(() => { setExpansions({}); setTexts({}); setTotal(null); }, [reviewId, path, commitMode, round, compare?.from, compare?.to]);

  const expandable = !commitMode && !!file && !file.binary && !file.tooLarge && file.hunks.some((h) => h.kind === 'text');
  const hunkSig = file ? file.hunks.map((h) => h.id).join() : '';
  useEffect(() => {
    if (!expandable || !path) return;
    let live = true;
    ep.fileLines(reviewId, path, source.side, 1, 1, source.round).then((r) => { if (live) setTotal(r.total); }, () => {});
    return () => { live = false; };
  }, [reviewId, path, source.side, expandable, hunkSig, source.round]);

  // Uncommitted threads that vanish between loads are kept (session-local) as tombstones.
  const seen = useRef<{ path: string; threads: Map<string, Thread> } | null>(null);
  useEffect(() => {
    if (!file || listed) return;
    const now = new Map(file.threads.map((t) => [t.id, t]));
    const prev = seen.current;
    if (uncommitted && prev && prev.path === file.path) {
      recordDropped(reviewId, [...prev.threads.values()].filter((t) => !now.has(t.id)));
      clearReturned(reviewId, [...now.keys()]);
    }
    seen.current = { path: file.path, threads: now };
  }, [file, uncommitted, reviewId, listed]);

  const ensureTexts = useCallback(async (spanFrom: number, spanTo: number, next: { top: number; bottom: number }) => {
    if (!path) return;
    const want: [number, number][] = [];
    if (next.top) want.push([spanFrom, spanFrom + next.top - 1]);
    if (next.bottom) want.push([spanTo - next.bottom + 1, spanTo]);
    const add: Record<number, string> = {};
    for (const [a, b] of want) {
      let lo = a; let hi = b;
      while (lo <= hi && textsRef.current[lo] !== undefined) lo++;
      while (hi >= lo && textsRef.current[hi] !== undefined) hi--;
      if (lo > hi) continue;
      for (const l of (await ep.fileLines(reviewId, path, source.side, lo, hi, source.round)).lines) add[l.n] = l.text;
    }
    if (Object.keys(add).length) setTexts((t) => ({ ...t, ...add }));
  }, [reviewId, path, source.side, source.round]);

  const expandTo = useCallback(async (changes: Record<string, { top: number; bottom: number }>) => {
    if (!file) return;
    const spans = gapSpans(file.hunks, total, side);
    try {
      for (const [gapKey, next] of Object.entries(changes)) {
        const span = spans.find((s) => s.gapKey === gapKey);
        if (span) await ensureTexts(span.from, span.to, next);
      }
      setExpansions((e) => ({ ...e, ...changes }));
    } catch (err) {
      toast.error(errorText(err));
    }
  }, [file, total, side, ensureTexts]);

  const expand = useCallback((gapKey: string, how: 'top' | 'bottom' | 'all') => {
    const span = file && gapSpans(file.hunks, total, side).find((s) => s.gapKey === gapKey);
    if (!span) return;
    const size = span.to - span.from + 1;
    const cur = expansions[gapKey] ?? { top: 0, bottom: 0 };
    const next = how === 'all' ? { top: size, bottom: 0 }
      : how === 'top' ? { top: Math.min(size - cur.bottom, cur.top + EXPAND_STEP), bottom: cur.bottom }
        : { top: cur.top, bottom: Math.min(size - cur.top, cur.bottom + EXPAND_STEP) };
    return expandTo({ [gapKey]: next });
  }, [file, total, side, expansions, expandTo]);

  /** Expand whatever collapsed context holds these lines (threads, a `lines=` target), from the nearer edge. */
  const reveal = useCallback((targets: { side: Side; n: number }[]) => {
    if (!file) return;
    const changes: Expansions = {};
    for (const t of targets) {
      const g = gapHolding(file.hunks, total, t.side, t.n, side);
      if (!g) continue;
      const cur = changes[g.gapKey] ?? expansions[g.gapKey] ?? { top: 0, bottom: 0 };
      changes[g.gapKey] = g.fromTop <= g.fromBottom ? { ...cur, top: Math.max(cur.top, g.fromTop) } : { ...cur, bottom: Math.max(cur.bottom, g.fromBottom) };
    }
    const need = Object.entries(changes).filter(([k, v]) => v.top !== (expansions[k]?.top ?? 0) || v.bottom !== (expansions[k]?.bottom ?? 0));
    if (need.length) void expandTo(Object.fromEntries(need));
  }, [file, total, side, expansions, expandTo]);

  const rows: Row[] = useMemo(
    () => (file && !file.binary && !file.tooLarge ? buildRows({ hunks: file.hunks, expansions, texts, total: commitMode ? null : total, side }) : []),
    [file, expansions, texts, total, side, commitMode],
  );

  const patch = fetched.mutate;
  const patchThread = useCallback((t: Thread) => patch((f) => {
    const rest = f.threads.filter((x) => x.id !== t.id);
    const belongs = t.anchor.file === f.path && t.status !== 'outdated';
    return { ...f, threads: belongs ? [...rest, t].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })) : rest };
  }), [patch]);
  const patchVerdict = useCallback((hunkId: string, verdict: Verdict) => patch((f) => ({ ...f, hunks: f.hunks.map((h) => (h.id === hunkId ? { ...h, verdict } : h)) })), [patch]);

  return {
    file, rows, side, total, expand, reveal, patchThread, patchVerdict, reload: compare ? compare.reload : fetched.reload,
    loading: commitMode ? false : compare ? !compare.files && !compare.error : fetched.loading && !fetched.data,
    error: commitMode ? undefined : compare ? compare.error : fetched.error,
  };
}
export type FileDiffState = ReturnType<typeof useFileDiff>;
