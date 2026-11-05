import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { groupAnchor, thread } from '@/test/fixtures';
import { renderInReview } from '@/test/renderCtx';
import { GuideHarness, guideNet, sampleGuide } from '@/test/guideWorld';
import { ThreadCard } from '@/features/threads/ThreadCard';
import { GuideStepView } from './GuideStepView';
import { RetiredGroupView } from './RetiredGroupView';

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

const TITLE = '<img src=x onerror="window.__xss = 1"><b>bold?</b>';

test('a retired group\'s markup title is literal text in its heading', () => {
  // Invariant: titles are React text children in the retired view too: no element, no script effect.
  const guide = sampleGuide({ retired: [{ id: 'g7', title: TITLE, retiredIn: 1, reason: 'refresh' }] });
  render(<GuideHarness guide={guide}><RetiredGroupView group={guide.retired[0]} guide={guide} /></GuideHarness>);
  const h = screen.getByRole('heading', { level: 2 });
  expect(h.textContent).toBe(TITLE);
  expect(h.children).toHaveLength(0);
  expect(document.querySelector('img, b')).toBeNull();
  expect((window as unknown as { __xss?: number }).__xss).toBeUndefined();
});

test.each([['current', false], ['retired', true]])('a %s group\'s markup title is literal text in a thread card\'s location link', (_n, retired) => {
  // Invariant: `groupLabel` output reaches the DOM as text only.
  const guide = retired ? sampleGuide({ retired: [{ id: 'g7', title: TITLE, retiredIn: 1, reason: 'refresh' }] }) : sampleGuide({}, { id: 'g7', title: TITLE });
  renderInReview(<ThreadCard thread={thread({ anchor: groupAnchor({ groupId: 'g7' }) })} showLocation />, { guide });
  const link = screen.getByRole('button', { name: /bold\?/ });
  expect(link.textContent).toBe(retired ? `${TITLE} (retired)` : `Step 1 · ${TITLE}`);
  expect(link.children).toHaveLength(0);
  expect(document.querySelector('img, b')).toBeNull();
  expect((window as unknown as { __xss?: number }).__xss).toBeUndefined();
});
