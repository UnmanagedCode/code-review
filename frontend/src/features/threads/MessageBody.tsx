import { RouteLink } from '@/components/RouteLink';
import { formatLines } from '@/lib/route';
import { segment } from '@/lib/messageText';
import type { Message } from '@/lib/types';

/** A message as text: citations become in-app links built from the route serialiser, `http(s)` runs become external links, everything else is a text node. */
export function MessageBody({ message }: { message: Message }) {
  return (
    <p className="text-sm break-words whitespace-pre-wrap">
      {segment(message.body, message.citations).map((s, i) => {
        if (s.t === 'text') return s.text;
        if (s.t === 'url') return <a key={i} href={s.href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">{s.text}</a>;
        return (
          <RouteLink key={i} to={{ file: s.path, side: 'new', lines: formatLines(s.start, s.end), thread: undefined }} className="font-mono text-primary underline underline-offset-2">
            {s.text}
          </RouteLink>
        );
      })}
    </p>
  );
}
