import type { Session } from './types';

/**
 * Option text for each session a select offers: its label, else its id. A label two or more of them share
 * (cc labels every untitled, unprompted session `(new session)`) gets each one's id prefix, so options stay distinct.
 */
export function sessionOptions(sessions: Session[]): { session: Session; name: string }[] {
  const nameOf = (s: Session) => s.label || s.sessionId;
  const counts = new Map<string, number>();
  for (const s of sessions) counts.set(nameOf(s), (counts.get(nameOf(s)) ?? 0) + 1);
  return sessions.map((s) => ({ session: s, name: counts.get(nameOf(s))! > 1 ? `${nameOf(s)} · ${s.sessionId.slice(0, 8)}` : nameOf(s) }));
}
