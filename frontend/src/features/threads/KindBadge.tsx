import { Badge } from '@/components/ui/badge';
import type { Severity, ThreadKind } from '@/lib/types';

const SEVERITY = { blocker: 'destructive', major: 'warning', minor: 'info', nit: 'secondary' } as const;

export function KindBadge({ kind, severity }: { kind: ThreadKind; severity: Severity | null }) {
  return (
    <>
      <Badge variant="outline">{kind}</Badge>
      {severity && <Badge variant={SEVERITY[severity]}>{severity}</Badge>}
    </>
  );
}
