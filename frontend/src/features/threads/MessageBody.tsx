import type { Message } from '@/lib/types';
import { Markdown } from './Markdown';

/**
 * A message's body, rendered as markdown. `atItsRound`: citation links open the round view of the round the message
 * was written in (leaving a comparison), since that is the code it cites.
 */
export function MessageBody({ message, atItsRound = false }: { message: Message; atItsRound?: boolean }) {
  const cite = atItsRound ? { compare: undefined, round: String(message.round) } : undefined;
  return <Markdown body={message.body} citations={message.citations} cite={cite} />;
}
