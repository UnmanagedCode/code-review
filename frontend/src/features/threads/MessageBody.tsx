import type { Message } from '@/lib/types';
import { Markdown } from './Markdown';

/** A message's body, rendered as markdown. */
export function MessageBody({ message }: { message: Message }) {
  return <Markdown body={message.body} citations={message.citations} />;
}
