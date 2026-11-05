import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { GuideHarness, guideNet, sampleGuide } from '@/test/guideWorld';
import { GuideStepView } from './GuideStepView';

const EVIL = '<script>window.__xss = 1</script>\n\n<img src=x onerror="window.__xss = 2">\n\n[click](javascript:alert(1))\n\nplain **text**';
const mount = (title: string, description: string) => {
  history.replaceState(null, '', '?review=r-1&view=guided&step=g1');
  guideNet();
  return render(<GuideHarness guide={sampleGuide({}, { title, description })}><GuideStepView /></GuideHarness>);
};

test('a hostile description renders no script or image element and no javascript: link', () => {
  // Invariant: descriptions go only through the Markdown boundary: no raw HTML, unsafe link targets never become anchors.
  mount('Title', EVIL);
  expect(document.querySelector('script')).toBeNull();
  expect(document.querySelector('img')).toBeNull();
  expect(document.querySelector('a[href^="javascript"]')).toBeNull();
  expect(document.querySelector('[onerror]')).toBeNull();
  expect((window as unknown as { __xss?: number }).__xss).toBeUndefined();
  expect(screen.getByText('plain').nextSibling).toBeNull();
});

test('a title with markup is literal text, not an element', () => {
  // Invariant: titles are React text children.
  mount('<img src=x onerror=alert(1)> <b>bold?</b>', 'ok');
  const h = screen.getByRole('heading', { level: 2 });
  expect(h.textContent).toBe('<img src=x onerror=alert(1)> <b>bold?</b>');
  expect(h.children).toHaveLength(0);
  expect(document.querySelector('img')).toBeNull();
});
