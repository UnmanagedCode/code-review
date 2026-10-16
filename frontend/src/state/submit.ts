import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { getBridge, sendPromptWithin } from '@/lib/bridge';
import * as ep from '@/lib/endpoints';
import { errorText, isBridgeCode } from '@/lib/refusals';
import type { Submission } from '@/lib/types';

export const SEND_DEADLINE_MS = 25_000;

export type SubmitState =
  | { phase: 'idle' }
  | { phase: 'composing' }
  | { phase: 'sending'; submission: Submission }
  | { phase: 'delivered'; submission: Submission }
  | { phase: 'failed'; submission: Submission; code: string }
  | { phase: 'timedOut'; submission: Submission }
  | { phase: 'manual'; submission: Submission };

export interface SubmitDeps {
  reviewId: string;
  /** Title shown in the "Sent to …" toast. */
  recipientLabel: string;
  /** Refetch the review after a recorded result. */
  onRecorded: () => void;
  /** `NO_RECIPIENT`: open the recipient picker. */
  onNoRecipient: () => void;
}

/** The submit-round state machine: compose → send through the cc bridge (or hand the text to the human) → record the result. */
export function useSubmission({ reviewId, recipientLabel, onRecorded, onNoRecipient }: SubmitDeps) {
  const [state, setState] = useState<SubmitState>({ phase: 'idle' });

  const record = useCallback(async (submission: Submission, result: { ok: boolean; code?: string }): Promise<'recorded' | 'stale' | 'error'> => {
    try {
      await ep.submissionResult(reviewId, submission.id, result);
      onRecorded();
      return 'recorded';
    } catch (e) {
      if ((e as { code?: string }).code === 'SUBMISSION_NOT_PENDING') {
        // Already recorded elsewhere: refetch once and leave the dialog.
        toast.info('Already recorded');
        onRecorded();
        setState({ phase: 'idle' });
        return 'stale';
      }
      toast.error(errorText(e));
      return 'error';
    }
  }, [reviewId, onRecorded]);

  const deliver = useCallback(async (submission: Submission) => {
    const bridge = getBridge();
    if (!bridge) { setState({ phase: 'manual', submission }); return; }
    setState({ phase: 'sending', submission });
    const outcome = await sendPromptWithin(bridge, submission.recipient, submission.text, SEND_DEADLINE_MS);
    if ('timedOut' in outcome) { setState({ phase: 'timedOut', submission }); return; }
    if (outcome.ok) {
      const recorded = await record(submission, { ok: true });
      if (recorded === 'recorded') {
        setState({ phase: 'delivered', submission });
        toast.success(`Sent to ${recipientLabel}`);
      } else if (recorded === 'error') {
        // The prompt went out but its result was not recorded: refetch so the header offers "Re-send" for the pending submission.
        setState({ phase: 'idle' });
        onRecorded();
      }
      return;
    }
    // An unrecognised code (a newer cc) is not recorded: the backend would refuse it.
    if (isBridgeCode(outcome.code) && (await record(submission, { ok: false, code: outcome.code })) === 'stale') return;
    setState({ phase: 'failed', submission, code: outcome.code });
  }, [record, recipientLabel, onRecorded]);

  const start = useCallback(async () => {
    setState({ phase: 'composing' });
    try {
      const { submission } = await ep.compose(reviewId);
      await deliver(submission);
    } catch (e) {
      setState({ phase: 'idle' });
      const code = (e as { code?: string }).code;
      if (code === 'NO_RECIPIENT') onNoRecipient();
      else if (code === 'NOTHING_TO_SUBMIT') toast.info(errorText(e));
      else toast.error(errorText(e));
    }
  }, [reviewId, deliver, onNoRecipient]);

  /** Send an existing submission again (a failed one, or one left pending after a reload). */
  const resend = useCallback((submission: Submission) => deliver(submission), [deliver]);
  const markSent = useCallback(async () => {
    if (state.phase !== 'manual' && state.phase !== 'failed' && state.phase !== 'timedOut') return;
    if ((await record(state.submission, { ok: true })) === 'recorded') setState({ phase: 'delivered', submission: state.submission });
  }, [state, record]);
  const close = useCallback(() => setState({ phase: 'idle' }), []);

  return { state, start, resend, markSent, close };
}
