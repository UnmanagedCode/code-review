import { render } from '@testing-library/react';
import { expect, test } from 'vitest';
import { message } from '@/test/fixtures';
import { MessageBody } from './MessageBody';

// Invariant: a message's body and its own citation list both reach the markdown renderer.
test('a message body renders through the markdown renderer with its citations', () => {
  const cite = { raw: 'a.ts#L2', path: 'a.ts', startLine: 2, endLine: 2 };
  const { container } = render(<MessageBody message={message({ body: '**b** a.ts#L2', citations: [cite] })} />);
  expect(container.querySelector('strong')?.textContent).toBe('b');
  expect(new URLSearchParams(container.querySelector('a')!.getAttribute('href')!).get('lines')).toBe('2');
});
