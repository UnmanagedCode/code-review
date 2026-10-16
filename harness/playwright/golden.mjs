// Golden-path interaction check: drives the real UI against a seeded world and saves a screenshot per step.
// Run: node harness/playwright/golden.mjs   (needs `npm install` first, for frontend/dist)
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER } from './resolve.mjs';
import { seed } from './seed.mjs';

const { withPage } = await import(BROWSER);

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(outDir, { recursive: true });
const HOST_URLS = /pluginBridge\.js|pluginTheme\.css/;

const world = await seed();
const { range, uncommitted } = world.ids;
const q = (o) => `${world.url}/?${new URLSearchParams({ project: 'app', worktree: 'feature', ...o })}`;

function watchErrors(page) {
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !HOST_URLS.test(m.text()) && !/^Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  page.on('response', (r) => { if (r.status() >= 400 && !HOST_URLS.test(r.url())) errors.push(`${r.status()} ${r.url()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}
const shotter = (page) => async (name) => {
  const file = path.join(outDir, `golden-${name}.png`);
  await page.screenshot({ path: file, animations: 'disabled' });
  console.log(`screenshot: ${file}`);
};

try {
  // 1–3: standalone (no cc bridge).
  await withPage(async (page) => {
    const errors = watchErrors(page);
    const shot = shotter(page);

    // 1. Drag-select lines in the gutter, post a question, and see it under the last selected line.
    await page.goto(q({ review: range, file: 'a.js' }));
    const cell = (n) => page.locator(`[data-cell="new:${n}"]`);
    await cell(10).scrollIntoViewIfNeeded();
    const [from, to] = [await cell(10).boundingBox(), await cell(11).boundingBox()];
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 6 });
    await page.mouse.up();
    await page.getByRole('toolbar', { name: 'Selection' }).getByText('L10–L11 (new)').waitFor();
    await shot('1-selected');
    await page.getByRole('button', { name: 'Comment', exact: true }).click();
    await page.getByLabel('Kind').selectOption('question');
    await page.getByLabel('Message').fill('Is this loop bound right?');
    await shot('1-composer');
    await page.getByRole('button', { name: 'Post' }).click();
    await page.locator('[role=rowgroup] article', { hasText: 'Is this loop bound right?' }).waitFor();
    const under = await page.evaluate(() => {
      const card = [...document.querySelectorAll('article')].find((a) => a.textContent.includes('Is this loop bound right?') && a.closest('[role="rowgroup"]'));
      const row = card?.parentElement?.previousElementSibling;
      return row?.querySelector('[data-cell="new:11"]') != null;
    });
    assert.ok(under, 'the question renders directly under line 11');
    await shot('1-posted');

    // 2. Accept a hunk; the tree tally follows.
    await page.goto(q({ review: range, file: 'c.js' }));
    const tree = page.getByRole('link', { name: /c\.js/ }).first();
    await tree.getByText('0 accepted, 0 rejected, 1 pending').waitFor();
    await page.getByRole('button', { name: 'Accept' }).first().click();
    await tree.getByText('1 accepted, 0 rejected, 0 pending').waitFor();
    await shot('2-accepted');

    // 3. Submit round without a bridge: copy dialog, Mark as sent, header says submitted.
    await page.getByRole('button', { name: 'Submit round' }).click();
    await page.getByLabel('Prompt').waitFor();
    await shot('3-copy-dialog');
    await page.getByRole('button', { name: 'Mark as sent' }).click();
    await page.getByText(/Round 2 · submitted/).waitFor();
    await shot('3-submitted');
    assert.deepEqual(errors, []);
  }, { headless: true, viewport: { width: 1280, height: 800 } });

  // 4: with a stub cc bridge.
  await withPage(async (page) => {
    const errors = watchErrors(page);
    const shot = shotter(page);
    await page.addInitScript(() => {
      const subs = new Set();
      const b = {
        session: undefined, sent: [], results: [],
        onSession(fn) { subs.add(fn); if (b.session !== undefined) fn(b.session); return () => subs.delete(fn); },
        async openSession() { return { ok: true }; },
        async sendPrompt(id, text) { b.sent.push([id, text]); return b.results.shift() ?? { ok: true }; },
      };
      window.ccBridge = b;
      window.__emit = (s) => { b.session = s; subs.forEach((f) => f(s)); };
    });
    await page.goto(`${world.url}/?project=app`);
    await page.getByText('No reviews yet').waitFor();
    await page.evaluate(() => window.__emit({ sessionId: 's-rev', project: 'app', worktree: null })); // baseline: matches the route
    await page.evaluate(() => window.__emit({ sessionId: 's-author', project: 'app', worktree: 'feature' }));
    await page.waitForFunction(() => location.search.includes('worktree=feature'));
    await page.getByText(/following/).waitFor();
    await shot('4-followed-session');

    await page.goto(q({ review: uncommitted }));
    // The stub is re-installed on navigation (no session emitted); make the first send fail.
    await page.evaluate(() => { window.ccBridge.results.push({ ok: false, code: 'SESSION_NOT_READY' }); });
    await page.getByRole('button', { name: 'Request review' }).click();
    await page.getByText(/busy or switching models/).waitFor();
    await shot('4-not-ready');
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.getByText(/Round 1 · submitted/).waitFor();
    const sent = await page.evaluate(() => window.ccBridge.sent.map(([id]) => id));
    assert.deepEqual(sent, ['s-author', 's-author']);
    await shot('4-delivered');
    assert.deepEqual(errors, []);
  }, { headless: true, viewport: { width: 1280, height: 800 } });
  console.log('golden path ok');
} finally {
  await world.close();
}
