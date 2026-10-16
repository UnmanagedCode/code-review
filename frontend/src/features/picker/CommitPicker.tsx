import { NativeSelect } from '@/components/ui/native-select';
import type { Commit } from '@/lib/types';

export function CommitPicker({ id, commits, value, onChange, placeholder }: { id: string; commits: Commit[]; value: string; onChange: (sha: string) => void; placeholder?: string }) {
  return (
    <NativeSelect className="w-full" id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {placeholder && <option value="">{placeholder}</option>}
      {commits.map((c) => <option key={c.sha} value={c.sha}>{c.short} {c.subject}</option>)}
    </NativeSelect>
  );
}
