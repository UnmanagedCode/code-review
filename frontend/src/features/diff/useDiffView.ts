import { useState } from 'react';
import * as storage from '@/lib/storage';
import { useMediaQuery, WIDE_QUERY } from '@/lib/useMediaQuery';
import { useWidthObserver } from '@/lib/useWidthObserver';

export type DiffView = 'inline' | 'split';
/** Narrowest diff pane that gets split: two 4rem gutter+marker strips leave ≈ 31 monospace chars per column. */
export const SPLIT_MIN_PX = 576; // 36rem
/** Once split, the pane must shrink this far below SPLIT_MIN_PX to leave it: covers a scrollbar appearing as split reflows. */
export const SPLIT_EXIT_SLACK_PX = 16;
const KEY = 'diffView';

/**
 * The chosen diff view (remembered in this browser) and the one shown: split only in the wide layout and while the
 * pane observed through `paneRef` is wide enough (entering at SPLIT_MIN_PX, leaving below SPLIT_MIN_PX −
 * SPLIT_EXIT_SLACK_PX). Attach `paneRef` to an element whose width does not depend on the view: a measured element the
 * view resizes, or a scroll container whose scrollbar comes and goes, could flip the view back and forth.
 */
export function useDiffView() {
  const wideLayout = useMediaQuery(WIDE_QUERY);
  // Unmeasured counts as narrow, so the first paint is never a split flash on a phone.
  const [roomy, setRoomy] = useState(false);
  const paneRef = useWidthObserver((w) => setRoomy((was) => w >= (was ? SPLIT_MIN_PX - SPLIT_EXIT_SLACK_PX : SPLIT_MIN_PX)));
  const [chosen, setChosen] = useState<DiffView>(() => (storage.getItem(KEY) === 'split' ? 'split' : 'inline'));
  const choose = (v: DiffView) => { setChosen(v); storage.setItem(KEY, v); };
  const available = wideLayout && roomy;
  return { paneRef, chosen, choose, available, view: available ? chosen : ('inline' as DiffView) };
}
