import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { contextBaseline, trimContext } from '@/lib/contextLines';
import { buildRows, gapNeeds, gapSpans, type Expansion, type Expansions, type Row } from '@/lib/diffRows';
import * as ep from '@/lib/endpoints';
import { errorText } from '@/lib/refusals';
import type { DiffFile, FileSig, Side, Thread, Verdict } from '@/lib/types';
import { ignoreWhitespace } from '@/lib/whitespace';
import { useDiffPrefs } from './diffPrefs';
import { clearReturned, recordDropped } from './dropped';
import { diffKey, diffSpec } from './diffResource';
import { useResource } from './resource';

export const EXPAND_STEP = 20;
const NONE: Expansion = { top: 0, bottom: 0 };
/** Per gap and edge, `pick` of the two expansions. */
const combine = (a: Expansions, b: Expansions, pick: (x: number, y: number) => number): Expansions => {
  const out: Expansions = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[k] ?? NONE; const y = b[k] ?? NONE;
    out[k] = { top: pick(x.top, y.top), bottom: pick(x.bottom, y.bottom) };
  }
  return out;
};

export interface FileDiffOptions {
  reviewId: string;
  path: string | undefined;
  /** The `sig` of the open file in the view's file list (review detail, or the round view's): the file is refetched when it differs from the cached diff's. */
  sig?: string;
  /** The review's load counter: the refetch trigger for a file without a `sig` (backend or response lacking it). */
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

/**
 * The open file's hunks and threads, its expandable context, and the local patches for mutation responses.
 * `rows` show the Diff options (`useDiffPrefs`) over git's hunks, display only: fewer context lines trim hunk-edge
 * context into the gaps, more open a baseline of each gap edge beside a hunk, and Ignore whitespace merges
 * whitespace-only pairs. `file.hunks` stay git's.
 */
export function useFileDiff({ reviewId, path, sig, version, uncommitted, commitFiles, round, compare }: FileDiffOptions) {
  const prefs = useDiffPrefs();
  const commitMode = !!commitFiles;
  const listed = commitMode || !!compare;
  const key = path && !listed ? diffKey(reviewId, round, path) : null;
  const versionRef = useRef(version);
  versionRef.current = version;
  const fetched = useResource(key, diffSpec(reviewId, round, path ?? '', () => String(versionRef.current)), { keepPrevious: true });
  const switching = fetched.placeholder;
  // Refetch when the cached diff is not the file's current one: its sig differs from the view's, or (a sig missing on either
  // side) the review's load counter moved past the one the diff was fetched at. That baseline lives on the cache entry
  // (`dataTag`), so a remount cannot adopt a diff fetched under an unknown one: a missing tag reloads.
  const compared = useRef('');
  useEffect(() => {
    if (!key || switching || fetched.loading || !fetched.data) return;
    if (sig !== undefined && fetched.data.sig !== undefined) {
      // Compared once per (file, view sig): a local patch (`patchSig`) moves the cached sig ahead of the view's until the
      // review reloads, and must not read as a stale diff.
      const id = `${key}\0${sig}`;
      if (compared.current === id) return;
      compared.current = id;
      if (fetched.data.sig !== sig) fetched.reload();
      return;
    }
    // A diff fetched before the review ever loaded (tag 0) is as current as the review's first load (version 1).
    if (fetched.dataTag === undefined || version > Math.max(Number(fetched.dataTag), 1)) fetched.reload();
  }, [key, sig, version, switching, fetched.loading, fetched.data]);

  const file: DiffFile | undefined = commitMode ? commitFiles.find((f) => f.path === path)
    : compare ? compare.files?.find((f) => f.path === path) : fetched.data;
  const side: Side = file?.status === 'deleted' ? 'old' : 'new';
  // Where gap lines are read: gap lines are the same on both sides, so a comparison reads a round's head.
  const source: { side: Side; round?: number } = compare ? { side: 'new', round: side === 'new' ? compare.to : compare.from } : { side, round };

  const [expansions, setExpansions] = useState<Expansions>({});
  // The context baseline whose lines have been fetched; what shows is at most the one wanted now.
  const [baseline, setBaseline] = useState<Expansions>({});
  const [fetchedTexts, setTexts] = useState<Record<number, string>>({});
  const [total, setTotal] = useState<number | null>(null);
  useEffect(() => { setExpansions({}); setBaseline({}); setTexts({}); textsRef.current = {}; setTotal(null); }, [reviewId, path, commitMode, round, compare?.from, compare?.to]);

  const shownTotal = commitMode ? null : total;
  const shown = useMemo(() => {
    if (!file || file.binary || file.tooLarge) return { hunks: [], seeded: {} };
    const trimmed = trimContext(file.hunks, prefs.context, { keepTail: shownTotal != null, side });
    return { hunks: prefs.ignoreWhitespace ? ignoreWhitespace(trimmed.hunks) : trimmed.hunks, seeded: trimmed.seeded };
  }, [file, prefs.context, prefs.ignoreWhitespace, shownTotal, side]);
  const texts = useMemo(() => ({ ...fetchedTexts, ...shown.seeded }), [fetchedTexts, shown.seeded]);
  const textsRef = useRef(texts);
  textsRef.current = texts;

  const expandable = !commitMode && !!file && !file.binary && !file.tooLarge && file.hunks.some((h) => h.kind === 'text');
  const hunkSig = file ? file.hunks.map((h) => h.id).join() : '';
  const lineCount = file?.lineCount;
  useEffect(() => {
    if (!expandable || !path || switching) return;
    // The response already counted this side of its own round; a comparison reads a round's head instead.
    if (!compare && lineCount) { setTotal(lineCount[source.side]); return; }
    let live = true;
    ep.fileLines(reviewId, path, source.side, 1, 1, source.round).then((r) => { if (live) setTotal(r.total); }, () => {});
    return () => { live = false; };
  }, [reviewId, path, source.side, expandable, hunkSig, source.round, lineCount?.old, lineCount?.new, switching]);

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
    if (!path || switching) return;
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
  }, [reviewId, path, source.side, source.round, switching]);

  const wantedBaseline = useMemo(() => (expandable && file ? contextBaseline(file.hunks, total, prefs.context, side) : {}), [expandable, file, total, prefs.context, side]);
  const effective = useMemo(() => combine(expansions, combine(wantedBaseline, baseline, Math.min), Math.max), [expansions, wantedBaseline, baseline]);
  useEffect(() => {
    if (!file || switching) return;
    let live = true;
    const spans = gapSpans(file.hunks, total, side);
    (async () => {
      for (const [gapKey, edge] of Object.entries(wantedBaseline)) {
        const span = spans.find((s) => s.gapKey === gapKey);
        if (span) await ensureTexts(span.from, span.to, edge);
      }
      if (live) setBaseline(wantedBaseline);
    })().catch((err) => { if (live) toast.error(errorText(err)); });
    return () => { live = false; };
  }, [JSON.stringify(wantedBaseline), path, switching]);

  const expandTo = useCallback(async (changes: Record<string, { top: number; bottom: number }>) => {
    if (!file || switching) return;
    const spans = gapSpans(shown.hunks, shownTotal, side);
    try {
      for (const [gapKey, next] of Object.entries(changes)) {
        const span = spans.find((s) => s.gapKey === gapKey);
        if (span) await ensureTexts(span.from, span.to, next);
      }
      setExpansions((e) => ({ ...e, ...changes }));
    } catch (err) {
      toast.error(errorText(err));
    }
  }, [file, switching, shown.hunks, shownTotal, side, ensureTexts]);

  const expand = useCallback((gapKey: string, how: 'top' | 'bottom' | 'all') => {
    const span = file && !switching && gapSpans(shown.hunks, shownTotal, side).find((s) => s.gapKey === gapKey);
    if (!span) return;
    const size = span.to - span.from + 1;
    const cur = effective[gapKey] ?? NONE;
    const next = how === 'all' ? { top: size, bottom: 0 }
      : how === 'top' ? { top: Math.min(size - cur.bottom, cur.top + EXPAND_STEP), bottom: cur.bottom }
        : { top: cur.top, bottom: Math.min(size - cur.top, cur.bottom + EXPAND_STEP) };
    return expandTo({ [gapKey]: next });
  }, [file, switching, shown.hunks, shownTotal, side, effective, expandTo]);

  /**
   * Expand whatever collapsed context holds these line spans (threads' ranges, a `lines=` target, the selection), each
   * from the nearer edge. Kept as the user's expansion, so a lower context setting never closes it.
   */
  const reveal = useCallback((targets: { side: Side; start: number; end: number }[]) => {
    if (!file || switching) return;
    const changes: Expansions = {};
    for (const t of targets) {
      for (const g of gapNeeds(shown.hunks, shownTotal, t.side, t.start, t.end, side)) {
        const cur = changes[g.gapKey] ?? expansions[g.gapKey] ?? NONE;
        changes[g.gapKey] = 'top' in g ? { ...cur, top: Math.max(cur.top, g.top) } : { ...cur, bottom: Math.max(cur.bottom, g.bottom) };
      }
    }
    const need = Object.entries(changes).filter(([k, v]) => v.top > (effective[k]?.top ?? 0) || v.bottom > (effective[k]?.bottom ?? 0));
    if (need.length) void expandTo(Object.fromEntries(need));
  }, [file, switching, shown.hunks, shownTotal, side, expansions, effective, expandTo]);

  const rows: Row[] = useMemo(
    () => (file && !file.binary && !file.tooLarge ? buildRows({ hunks: shown.hunks, expansions: effective, texts, total: shownTotal, side }) : []),
    [file, shown.hunks, effective, texts, shownTotal, side],
  );

  const patch = fetched.mutate;
  const patchThread = useCallback((t: Thread) => patch((f) => {
    const rest = f.threads.filter((x) => x.id !== t.id);
    const belongs = t.anchor.file === f.path && t.status !== 'outdated';
    return { ...f, threads: belongs ? [...rest, t].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })) : rest };
  }), [patch]);
  const patchVerdict = useCallback((hunkId: string, verdict: Verdict) => patch((f) => ({ ...f, hunks: f.hunks.map((h) => (h.id === hunkId ? { ...h, verdict } : h)) })), [patch]);
  /** The server's new sig for the file a write touched: the patches above made the cached diff match it, so no refetch is due. */
  const patchSig = useCallback((fs: FileSig | undefined) => {
    if (fs?.sig && fs.path === path) patch((f) => ({ ...f, sig: fs.sig! }));
  }, [patch, path]);

  return {
    file, rows, side, total, switching, expand, reveal, patchThread, patchVerdict, patchSig, reload: compare ? compare.reload : fetched.reload,
    loading: commitMode ? false : compare ? !compare.files && !compare.error : fetched.loading && (!fetched.data || switching),
    error: commitMode ? undefined : compare ? compare.error : fetched.error,
  };
}
export type FileDiffState = ReturnType<typeof useFileDiff>;
