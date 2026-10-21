import type { Row } from './diffRows';
import type { DiffLine, Side } from './types';

export type SplitRow =
  | Extract<Row, { kind: 'hunk' }> | Extract<Row, { kind: 'gap' }>
  | { kind: 'pair'; key: string; left: DiffLine | null; right: DiffLine | null };
type Pair = Extract<SplitRow, { kind: 'pair' }>;

/**
 * Side-by-side rows from the flat rows. Context sits on both sides of one pair; a run of deletions and additions
 * (between context, hunk and gap rows) pairs its n-th deletion with its n-th addition, padding the shorter side.
 * Each side keeps the flat rows' line order and every source line lands in exactly one pair, so selection can keep
 * working on the flat rows.
 */
export function splitRows(rows: Row[]): SplitRow[] {
  const out: SplitRow[] = [];
  let dels: Extract<Row, { kind: 'line' }>[] = [];
  let adds: Extract<Row, { kind: 'line' }>[] = [];
  const flush = () => {
    for (let i = 0; i < Math.max(dels.length, adds.length); i++) {
      const d = dels[i], a = adds[i];
      out.push({ kind: 'pair', key: (d ?? a).key, left: d?.line ?? null, right: a?.line ?? null });
    }
    dels = [];
    adds = [];
  };
  for (const r of rows) {
    if (r.kind === 'line' && r.line.t === 'del') dels.push(r);
    else if (r.kind === 'line' && r.line.t === 'add') adds.push(r);
    else {
      flush();
      out.push(r.kind === 'line' ? { kind: 'pair', key: r.key, left: r.line, right: r.line } : r);
    }
  }
  flush();
  return out;
}

/** The line number a pair carries on `side`: left holds old numbers, right holds new. */
export function pairLine(p: Pair, side: Side): number | null {
  return side === 'old' ? p.left?.old ?? null : p.right?.new ?? null;
}
