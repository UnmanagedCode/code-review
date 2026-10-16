import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { message } from '@/test/fixtures';
import { MessageBody } from './MessageBody';

const cite = { raw: 'src/a.ts#L10-L20', path: 'src/a.ts', startLine: 10, endLine: 20 };

test('markup in a body renders as literal text, never as elements', () => {
  const body = '<img src=x onerror=alert(1)><script>alert(2)</script>';
  const { container } = render(<MessageBody message={message({ body })} />);
  expect(container.querySelector('img, script')).toBeNull();
  expect(container.textContent).toBe(body);
});

test('a citation link’s href is built from the route and decodes to file= and lines=, not the raw text', () => {
  render(<MessageBody message={message({ body: `see ${cite.raw}`, citations: [cite] })} />);
  const href = screen.getByRole('link', { name: cite.raw }).getAttribute('href')!;
  expect(href.startsWith('?')).toBe(true);
  const p = new URLSearchParams(href);
  expect(p.get('file')).toBe('src/a.ts');
  expect(p.get('lines')).toBe('10-20');
  expect(href).not.toBe(cite.raw);
});

test('a javascript: URL is not a link', () => {
  render(<MessageBody message={message({ body: 'click javascript:alert(1) now' })} />);
  expect(screen.queryByRole('link')).toBeNull();
});

test('an https URL is an external link with noopener noreferrer', () => {
  render(<MessageBody message={message({ body: 'docs: https://example.com/a?b=1.' })} />);
  const a = screen.getByRole('link', { name: 'https://example.com/a?b=1' });
  expect(a.getAttribute('href')).toBe('https://example.com/a?b=1');
  expect(a.getAttribute('target')).toBe('_blank');
  expect(a.getAttribute('rel')).toMatch(/noopener/);
  expect(a.getAttribute('rel')).toMatch(/noreferrer/);
});

test('clicking a citation navigates in-app (pushState) instead of loading a page', () => {
  const push = vi.spyOn(history, 'pushState');
  render(<MessageBody message={message({ body: cite.raw, citations: [cite] })} />);
  const notPrevented = fireEvent.click(screen.getByRole('link'));
  expect(notPrevented).toBe(false);
  expect(push).toHaveBeenCalled();
  expect(location.search).toContain('lines=10-20');
});
