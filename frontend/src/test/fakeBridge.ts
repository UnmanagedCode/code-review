import { vi } from 'vitest';
import type { BridgeResult, BridgeSession, CcBridge } from '@/lib/bridge';

export interface FakeBridge extends CcBridge {
  emit(s: BridgeSession | null): void;
  sendPrompt: ReturnType<typeof vi.fn<(sid: string, text: string) => Promise<BridgeResult>>>;
  openSession: ReturnType<typeof vi.fn<(sid: string) => Promise<BridgeResult>>>;
}

/** Installs `window.ccBridge`; `sendPrompt`/`openSession` resolve `{ok:true}` until programmed otherwise. */
export function installBridge(session?: BridgeSession | null): FakeBridge {
  const fns = new Set<(s: BridgeSession | null) => void>();
  const bridge: FakeBridge = {
    session,
    onSession(fn) {
      fns.add(fn);
      if (bridge.session !== undefined) fn(bridge.session);
      return () => fns.delete(fn);
    },
    emit(s) { bridge.session = s; fns.forEach((f) => f(s)); },
    openSession: vi.fn(async () => ({ ok: true as const })),
    sendPrompt: vi.fn(async () => ({ ok: true as const })),
  };
  window.ccBridge = bridge;
  return bridge;
}
