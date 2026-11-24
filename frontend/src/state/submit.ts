import { useCallback, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { getBridge, sendPromptWithin } from '@/lib/bridge';
import * as ep from '@/lib/endpoints';
import { errorText, isBridgeCode } from '@/lib/refusals';
import type { Submission } from '@/lib/types';

export const SEND_DEADLINE_MS = 25_000;

/**
 * Submissions this page is delivering right now, shared by every `useSubmission` instance (the header's and Guide me's):
 * the review's "not recorded as delivered" banner must not offer a re-send of a prompt still on its way.
 */
const inFlight = new Set<string>();
const listeners = new Set<() => void>();
const publish = () => listeners.forEach((l) => l());
const flight = (id: string | number, on: boolean) => { if (on) inFlight.add(String(id)); else inFlight.delete(String(id)); publish(); };
export function resetInFlight(): void { inFlight.clear(); publish(); }
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
/** Whether this page is delivering submission `id` right now. */
export const useInFlight = (id: string | number | undefined): boolean => useSyncExternalStore(subscribe, () => id !== undefined && inFlight.has(String(id)));

export type SubmitState =
  | { phase: 'idle' }
  /** The recap dialog is open; nothing is composed yet. */
  | { phase: 'recap' }
  /** `viaRecap`: the recap dialog stays open while this runs. */
  | { phase: 'composing'; viaRecap?: true }
  | { phase: 'sending'; submission: Submission; viaRecap?: true }
  | { phase: 'delivered'; submission: Submission }
  | { phase: 'failed'; submission: Submission; code: string }
  | { phase: 'timedOut'; submission: Submission }
  | { phase: 'manual'; submission: Submission };

export interface SubmitDeps {
  reviewId: string;
  /** Composes the submission to deliver: the round's (`ep.compose`, with the overall note) or a Guide me prompt (`ep.guideMe`). */
  compose: (note?: string) => Promise<{ submission: Submission }>;
  /** Title shown in the "Sent to …" toast. */
  recipientLabel: string;
  /** Refetch the review after a recorded result. */
  onRecorded: () => void;
  /** `NO_RECIPIENT`: open the recipient picker. */
  onNoRecipient: () => void;
}

/** The submit-round state machine: compose → send through the cc bridge (or hand the text to the human) → record the result. */
export function useSubmission({ reviewId, compose, recipientLabel, onRecorded, onNoRecipient }: SubmitDeps) {
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

  const deliver = useCallback(async (submission: Submission, viaRecap?: true) => {
    const bridge = getBridge();
    if (!bridge) { setState({ phase: 'manual', submission }); return; }
    setState({ phase: 'sending', submission, ...(viaRecap && { viaRecap }) });
    // In flight until the outcome is recorded (or the send timed out), not merely until the bridge answered.
    flight(submission.id, true);
    try {
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
    } finally { flight(submission.id, false); }
  }, [record, recipientLabel, onRecorded]);

  const refused = useCallback((e: unknown, back: SubmitState) => {
    setState(back);
    const code = (e as { code?: string }).code;
    if (code === 'NO_RECIPIENT') onNoRecipient();
    else if (code === 'NOTHING_TO_SUBMIT') toast.info(errorText(e));
    else toast.error(errorText(e));
  }, [onNoRecipient]);

  /** Compose and deliver straight away (Guide me). */
  const start = useCallback(async () => {
    setState({ phase: 'composing' });
    try {
      const { submission } = await compose();
      await deliver(submission);
    } catch (e) { refused(e, { phase: 'idle' }); }
  }, [compose, deliver, refused]);

  /** Open the round recap; nothing is composed or sent until `send`. */
  const review = useCallback(() => setState({ phase: 'recap' }), []);
  /** From the recap: compose the round with the overall note and deliver it; a refusal returns to the recap and answers false. */
  const send = useCallback(async (note: string): Promise<boolean> => {
    setState({ phase: 'composing', viaRecap: true });
    let submission: Submission;
    try { ({ submission } = await compose(note)); } catch (e) { refused(e, { phase: 'recap' }); return false; }
    await deliver(submission, true);
    return true;
  }, [compose, deliver, refused]);

  /** Send an existing submission again (a failed one, or one left pending after a reload). */
  const resend = useCallback((submission: Submission) => deliver(submission), [deliver]);
  const markSent = useCallback(async () => {
    if (state.phase !== 'manual' && state.phase !== 'failed' && state.phase !== 'timedOut') return;
    if ((await record(state.submission, { ok: true })) === 'recorded') setState({ phase: 'delivered', submission: state.submission });
  }, [state, record]);
  const close = useCallback(() => setState({ phase: 'idle' }), []);

  return { state, start, review, send, resend, markSent, close };
}
