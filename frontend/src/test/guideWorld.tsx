import { useState, type ReactNode } from 'react';
import { vi } from 'vitest';
import type { GuideGroup, GuideHunk, GuideView, Verdict } from '@/lib/types';
import { diffPatchers } from '@/state/diffResource';
import { ReviewProvider, type ReviewCtx } from '@/state/reviewContext';
import { diffFile, fileState, guideGroup, guideView, hunk, review } from './fixtures';
import { ctxValue } from './renderCtx';
import { stubFetch } from './stubFetch';

/** Hunk id → [file, header, newStart]: two files, three groups' worth of hunks. */
const HUNKS: Record<string, [string, number]> = { h1: ['a.ts', 1], h2: ['a.ts', 20], h3: ['b.ts', 1], h4: ['b.ts', 30] };
export const headerOf = (id: string) => `@@ -${HUNKS[id][1]},4 +${HUNKS[id][1]},4 @@`;

const gh = (id: string, verdict: Verdict = 'pending'): GuideHunk => ({ id, file: HUNKS[id][0], verdict });

/** g1 spans both files (h1, h3), g2 is one hunk (h2), h4 is in no group: Other changes. */
export function sampleGuide(over: Partial<GuideView> = {}, g1: Partial<GuideGroup> = {}, g2: Partial<GuideGroup> = {}): GuideView {
  return guideView({
    groups: [
      guideGroup({ id: 'g1', order: 1, title: 'Wire it up', description: 'First **bold** part.', hunks: [gh('h1'), gh('h3')], ...g1 }),
      guideGroup({ id: 'g2', order: 2, title: 'Tidy', description: 'Second part.', hunks: [gh('h2')], ...g2 }),
    ],
    ungrouped: [gh('h4')],
    ...over,
  });
}

export const GUIDE_FILES = [fileState({ path: 'a.ts', sig: 'sa' }), fileState({ path: 'b.ts', sig: 'sb' })];

/**
 * Stubs the two files' diffs (their hunk verdicts follow `verdicts`) plus any extra routes, and returns the network log.
 * Every hunk starts pending unless `verdicts` says otherwise.
 */
export function guideNet(verdicts: Record<string, Verdict> = {}, extra: Record<string, unknown> = {}) {
  return stubFetch({
    'GET api/reviews/r-1/diff': (u: URL) => {
      const path = u.searchParams.get('file')!;
      const hunks = Object.entries(HUNKS).filter(([, [file]]) => file === path)
        .map(([id, [, start]]) => hunk({ id, header: headerOf(id), oldStart: start, newStart: start, verdict: verdicts[id] ?? 'pending' }));
      return { review: review(), files: [diffFile({ path, sig: path === 'a.ts' ? 'sa' : 'sb', hunks })] };
    },
    ...extra,
  });
}

/** A provider whose guide is state (`patchGuide` really patches it) and whose `diffs` really patch the cached diffs; `spies` stay stable across renders. */
export function GuideHarness({ guide, spies, children }: { guide: GuideView; spies?: Partial<ReviewCtx>; children: ReactNode }) {
  const [g, setG] = useState(guide);
  const value = ctxValue({
    guide: g, files: GUIDE_FILES, patchGuide: (fn) => setG((cur) => fn(cur)), diffs: diffPatchers('r-1'),
    reload: vi.fn(), applyReview: vi.fn(), ...spies,
  });
  return <ReviewProvider value={value}>{children}</ReviewProvider>;
}
