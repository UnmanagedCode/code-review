import { NativeSelect } from '@/components/ui/native-select';
import type { Commit } from '@/lib/types';

/** `extra`: a commit to offer besides `commits` (a prefilled one older than the listed), shown first unless already listed. */
export function CommitPicker({ id, commits, value, onChange, placeholder, extra }: {
  id: string; commits: Commit[]; value: string; onChange: (sha: string) => void; placeholder?: string; extra?: Commit;
}) {
  const all = extra && !commits.some((c) => c.sha === extra.sha) ? [extra, ...commits] : commits;
  return (
    <NativeSelect className="w-full" id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {placeholder && <option value="">{placeholder}</option>}
      {all.map((c) => <option key={c.sha} value={c.sha}>{c.short} {c.subject}</option>)}
    </NativeSelect>
  );
}
