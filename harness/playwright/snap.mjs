// Visual check of the UI: seeds one world (seed.mjs), then screenshots each screen in light and dark at desktop and
// phone width, and fails on console errors other than the two host URLs that 404 outside cc.
// Run: node harness/playwright/snap.mjs   (needs `npm install` first, for frontend/dist)
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER } from './resolve.mjs';
import { seed } from './seed.mjs';

const { withPage } = await import(BROWSER);

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(outDir, { recursive: true });

const HOST_URLS = /pluginBridge\.js|pluginTheme\.css/;
const VIEWPORTS = { desktop: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } };

const world = await seed();
const { range, uncommitted, conducted } = world.ids;
const q = (o) => `${world.url}/?${new URLSearchParams({ project: 'app', worktree: 'feature', ...o })}`;
try {
  await withPage(async (page) => {
    const errors = [];
    let systemDown = false; // while the fake system is down, its 502 refusals are the expected answers
    // Chromium words a failed load as a generic "Failed to load resource" line with no URL, so judge failures by response URL.
    page.on('console', (m) => {
      if (m.type() === 'error' && !HOST_URLS.test(m.text()) && !/^Failed to load resource/.test(m.text())) errors.push(m.text());
    });
    page.on('response', (r) => {
      if (r.status() >= 400 && !HOST_URLS.test(r.url()) && !(systemDown && r.status() === 502)) errors.push(`${r.status()} ${r.url()}`);
    });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const [vp, size] of Object.entries(VIEWPORTS)) {
        await page.setViewportSize(size);
        const shot = async (name) => {
          const file = path.join(outDir, `${name}-${scheme}-${vp}.png`);
          await page.screenshot({ path: file, animations: 'disabled' });
          console.log(`screenshot: ${file}`);
        };
        const open = async (url, ready) => { await page.goto(url); await ready.first().waitFor(); };

        await open(world.url, page.getByText('Choose a project to review'));
        const dark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
        if (dark !== (scheme === 'dark')) throw new Error(`${scheme}: html.dark is ${dark}`);

        await open(q({}), page.getByText('Feature work'));
        await shot('review-list');

        await open(q({ view: 'new' }), page.getByRole('dialog'));
        await page.getByRole('radio', { name: /main/ }).first().waitFor();
        await shot('new-review');

        await open(q({ review: range }), page.getByRole('link', { name: /a\.js/ }));
        await shot('review-overview'); // header, refresh banner, file tree

        await open(q({ review: range, file: 'a.js' }), page.getByRole('grid'));
        await page.getByRole('article').first().waitFor();
        await shot('diff');

        if (vp === 'desktop') {
          // Split needs a 36rem diff pane; at 1280px the default 384px side pane leaves room, but shoot it at 1100px,
          // the narrowest common desktop width that still gets split.
          await page.setViewportSize({ width: 1100, height: 800 });
          await open(q({ review: range, file: 'a.js' }), page.getByRole('grid'));
          await page.getByRole('group', { name: 'Diff view' }).getByRole('button', { name: 'Split' }).click();
          await page.getByRole('button', { name: /^@@.*accepted$/ }).waitFor();
          await shot('diff-split-collapsed'); // the seeded accepted hunk, collapsed
          await page.getByRole('button', { name: /^@@.*accepted$/ }).click();
          await page.locator('[data-cell="new:6"]').waitFor();
          await shot('diff-split');
          // Rounds 1 → 2 compared, in the split view just chosen: round 1's threads on the left, round 2's on the right.
          await open(q({ review: range, compare: '1..2', file: 'a.js' }), page.locator('[role=row].grid'));
          await page.locator('[role=rowgroup] article').first().waitFor();
          await shot('diff-compare');
          await page.getByRole('group', { name: 'Diff view' }).getByRole('button', { name: 'Inline' }).click();
          await page.setViewportSize(size);
          await open(q({ review: range, file: 'a.js' }), page.getByRole('grid'));
          await page.getByRole('tablist', { name: 'Review pane' }).getByRole('tab', { name: /^Threads/ }).click();
        } else {
          // A phone shows the pane or the diff: the Threads tab is the pane's, so open it without a file.
          await open(q({ review: range, view: 'threads' }), page.getByRole('tab', { name: /Outdated/ }));
        }
        await page.getByRole('tab', { name: /^All/ }).click();
        await page.getByRole('tabpanel').getByRole('article').first().waitFor();
        await shot('threads-all');
        await page.getByRole('tabpanel').getByLabel('Owner').selectOption('agents');
        await shot('threads-owner-agents');
        await page.getByRole('tabpanel').getByLabel('Owner').selectOption('all');
        await page.getByRole('tab', { name: /Outdated/ }).click();
        await page.getByText(/outdated · was/).first().waitFor();
        await shot('threads-outdated');

        // History: the rounds newest first, the current round's commits under it.
        await open(q({ review: range, view: 'history' }), page.getByRole('navigation', { name: 'History' }).getByRole('link', { name: /^[0-9a-f]{7} / }));
        await shot('history');

        // Round 1 of the range review, read-only: the banner, then a.js with the question that is outdated now.
        await open(q({ review: range, round: '1' }), page.getByRole('button', { name: 'Back to current round' }));
        await page.getByRole('link', { name: /a\.js/ }).first().waitFor();
        await shot('round-1-overview');
        await open(q({ review: range, round: '1', file: 'a.js' }), page.getByRole('grid'));
        await page.getByRole('article').first().waitFor();
        await shot('round-1-diff');
        if (vp === 'phone') {
          await open(q({ review: range, compare: '1..2', file: 'a.js' }), page.getByRole('grid'));
          await page.locator('[role=rowgroup] article').first().waitFor();
          await shot('diff-compare'); // inline: one combined diff
        }

        await open(q({ review: range, file: 'logo.bin' }), page.getByText('Binary file changed'));
        await shot('binary-file');

        await open(q({ review: range }), page.getByRole('button', { name: 'Submit round' }));
        await page.getByRole('button', { name: 'Submit round' }).click();
        await page.getByRole('dialog').waitFor();
        await page.getByLabel('Prompt').waitFor();
        await shot('submit-dialog');
        await page.getByRole('button', { name: 'Close' }).first().click();

        await open(q({ review: conducted }), page.getByText('Author: s-author'));
        await shot('conducted-header'); // recipient = the conductor, author = the worker

        await open(q({ review: uncommitted, file: 'a.js' }), page.getByRole('grid'));
        await page.getByRole('article').first().waitFor();
        await shot('uncommitted');

        // The project's System is down: the review still opens, showing why its diff is unavailable.
        await page.goto('about:blank'); // nothing of the previous page is still loading
        world.systemDown(true);
        systemDown = true;
        try {
          await open(q({ review: range }), page.getByText(/system is unreachable/));
          await shot('system-down');
          await page.goto('about:blank');
        } finally {
          world.systemDown(false);
          systemDown = false;
        }
      }
    }
    if (errors.length) throw new Error(`unexpected console errors:\n${errors.join('\n')}`);
  }, { headless: true, viewport: VIEWPORTS.desktop });
} finally {
  await world.close();
}
