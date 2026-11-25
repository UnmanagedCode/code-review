import type { ComponentProps } from 'react';
import type { FileState } from '@/lib/types';
import { cn } from '@/lib/utils';

const STATUS: Record<FileState['status'], string> = { added: 'A', deleted: 'D', modified: 'M', renamed: 'R' };

/** A file's status as one letter, named in full for assistive tech. */
export function StatusLetter({ status, className, ...rest }: { status: FileState['status'] } & ComponentProps<'span'>) {
  return (
    <span {...rest} className={cn('font-mono text-xs text-muted-foreground', className)}>
      <span aria-hidden>{STATUS[status]}</span>
      <span className="sr-only">{status} </span>
    </span>
  );
}
