import { useEffect, useState } from 'react';
import * as ep from '@/lib/endpoints';
import { useFetch } from './useFetch';

export const NOTE_DEBOUNCE_MS = 300;

/**
 * The round recap the dialog shows. `rows` refetch when the review changes underneath (`rev`), so the counts stay live;
 * `text` (the prompt as it would be sent with the note) is fetched only while the preview is open, debounced by the note.
 */
export function useRoundRecap(reviewId: string, open: boolean, previewOpen: boolean, note: string, rev: number) {
  const [debounced, setDebounced] = useState(note);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(note), NOTE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [note]);
  const rows = useFetch(open ? () => ep.previewRound(reviewId) : null, [reviewId, open, rev]);
  const text = useFetch(previewOpen ? () => ep.previewRound(reviewId, debounced) : null, [reviewId, previewOpen, debounced, rev]);
  return { recap: rows.data?.recap, error: rows.error, loading: rows.loading, text: text.data?.recap.text };
}
