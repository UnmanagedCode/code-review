import type { Hunk, GuideGroup, GuideHunk, GuideView, ReviewSummary, Verdict } from './types';
import type { Route } from './route';

/** The step key of the hunks that are in no group. */
export const OTHER = 'other';

export type Step =
  | { key: string; n: number; kind: 'group'; group: GuideGroup }
  | { key: typeof OTHER; n: number; kind: 'other'; hunks: GuideHunk[] };

/** The round's steps in reading order, numbered from 1; "Other changes" comes last, only when some hunk is in no group. */
export function guideSteps(guide: GuideView): Step[] {
  const steps: Step[] = [...guide.groups].sort((a, b) => a.order - b.order).map((group, i) => ({ key: group.id, n: i + 1, kind: 'group', group }));
  if (guide.ungrouped?.length) steps.push({ key: OTHER, n: steps.length + 1, kind: 'other', hunks: guide.ungrouped });
  return steps;
}

/** The routed step: the first when none is routed, null when the key names none. */
export function stepAt(steps: Step[], key: string | undefined): Step | null {
  if (key === undefined) return steps[0] ?? null;
  return steps.find((s) => s.key === key) ?? null;
}

/** Group steps by verdict; "Other changes" has none and only counts toward `total`. */
export function guideProgress(steps: Step[]): { total: number; accepted: number; rejected: number } {
  const groups = steps.filter((s): s is Extract<Step, { kind: 'group' }> => s.kind === 'group');
  return {
    total: steps.length,
    accepted: groups.filter((s) => s.group.verdict === 'accepted').length,
    rejected: groups.filter((s) => s.group.verdict === 'rejected').length,
  };
}

/** Hunks bucketed by file in first-appearance order; a null file (unreadable snapshot) is kept as one bucket. */
export function byFile(hunks: GuideHunk[]): { file: string | null; hunks: GuideHunk[] }[] {
  const out: { file: string | null; hunks: GuideHunk[] }[] = [];
  for (const h of hunks) {
    const bucket = out.find((b) => b.file === h.file);
    if (bucket) bucket.hunks.push(h); else out.push({ file: h.file, hunks: [h] });
  }
  return out;
}

/** The route of "Open in file": the hunk's new-side lines (old side for a pure deletion), or just the file for a file-level hunk. */
export function hunkPlace(path: string, hunk: Hunk): Route {
  if (hunk.kind === 'text') {
    if (hunk.newLines > 0) return { file: path, side: 'new', lines: `${hunk.newStart}-${hunk.newStart + hunk.newLines - 1}`, thread: undefined };
    return { file: path, side: 'old', lines: `${hunk.oldStart}-${hunk.oldStart + Math.max(hunk.oldLines, 1) - 1}`, thread: undefined };
  }
  return { file: path, side: undefined, lines: undefined, thread: undefined };
}

/** What a group thread's location link names: a current group by step and title, a retired one marked so. */
export function groupLabel(guide: GuideView, groupId: string): string {
  const step = guideSteps(guide).find((s) => s.key === groupId);
  if (step?.kind === 'group') return `Step ${step.n} · ${step.group.title}`;
  const retired = guide.retired.find((r) => r.id === groupId);
  return retired ? `${retired.title} (retired)` : `Group ${groupId}`;
}

const mapHunks = (guide: GuideView, fn: (h: GuideHunk) => GuideHunk): GuideView => ({
  ...guide, groups: guide.groups.map((g) => ({ ...g, hunks: g.hunks.map(fn) })), ungrouped: guide.ungrouped && guide.ungrouped.map(fn),
});

/** Only the group's own verdict: its hunks' writes come from the server's response, never from here. */
export const withGroupVerdict = (guide: GuideView, groupId: string, verdict: Verdict): GuideView => ({
  ...guide, groups: guide.groups.map((g) => (g.id === groupId ? { ...g, verdict } : g)),
});

export const clearGroups = (guide: GuideView, ids: string[]): GuideView => ({
  ...guide, groups: guide.groups.map((g) => (ids.includes(g.id) ? { ...g, verdict: 'pending' as const } : g)),
});

/** Hunk verdicts by id, in every group and in the ungrouped list. */
export const withHunkVerdicts = (guide: GuideView, verdicts: Record<string, Verdict>): GuideView =>
  mapHunks(guide, (h) => (verdicts[h.id] ? { ...h, verdict: verdicts[h.id] } : h));

/** The Guided tab exists on a live (not past, not commit-filtered) review with a guide that has groups or offers Guide me. */
export function guideAvailable({ review, guide, pastView, commit }: { review: ReviewSummary; guide: GuideView | null; pastView: boolean; commit: string | undefined }): boolean {
  return review.kind !== 'uncommitted' && !!guide && !pastView && !commit && (guide.groups.length > 0 || guide.guideMe.offered);
}

/** The collapsed file bar's status text: hunk count, pending or decided, and open line threads when there are any. */
export function fileSummary(hunks: GuideHunk[], openThreads: number): string {
  const pending = hunks.filter((h) => h.verdict === 'pending').length;
  const parts = [`${hunks.length} ${hunks.length === 1 ? 'hunk' : 'hunks'}`, pending ? `${pending} pending` : 'decided'];
  if (openThreads) parts.push(`${openThreads} open ${openThreads === 1 ? 'thread' : 'threads'}`);
  return parts.join(' · ');
}
