import { useSyncExternalStore } from 'react';

export interface BridgeSession { sessionId: string; project: string; worktree: string | null }
export type BridgeResult = { ok: true } | { ok: false; code: string };
export interface CcBridge {
  session: BridgeSession | null | undefined;
  onSession(fn: (s: BridgeSession | null) => void): () => void;
  openSession(sessionId: string): Promise<BridgeResult>;
  sendPrompt(sessionId: string, text: string): Promise<BridgeResult>;
}
declare global { interface Window { ccBridge?: CcBridge } }

/** Read on each call, never cached: the bridge is absent standalone and appears only when embedded. */
export const getBridge = (): CcBridge | undefined => window.ccBridge;

export type SendOutcome = BridgeResult | { timedOut: true };

/** `sendPrompt` with our own deadline: a frame that reloads mid-call loses cc's reply. */
export function sendPromptWithin(bridge: CcBridge, sessionId: string, text: string, ms: number): Promise<SendOutcome> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ timedOut: true }), ms);
    bridge.sendPrompt(sessionId, text).then(
      (r) => { clearTimeout(timer); resolve(r); },
      () => { clearTimeout(timer); resolve({ ok: false, code: 'HOST_ERROR' }); },
    );
  });
}

function subscribe(onChange: () => void): () => void {
  return getBridge()?.onSession(onChange) ?? (() => {});
}
/** The active cc session: undefined until cc answers (or without a bridge), null when none is selected. */
export function useBridgeSession(): BridgeSession | null | undefined {
  return useSyncExternalStore(subscribe, () => getBridge()?.session);
}
