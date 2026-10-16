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
const { range, uncommitted } = world.ids;
const q = (o) => `${world.url}/?${new URLSearchParams({ project: 'app', worktree: 'feature', ...o })}`;
try {
  await withPage(async (page) => {
    const errors = [];
    // Chromium words a failed load as a generic "Failed to load resource" line with no URL, so judge failures by response URL.
    page.on('console', (m) => {
      if (m.type() === 'error' && !HOST_URLS.test(m.text()) && !/^Failed to load resource/.test(m.text())) errors.push(m.text());
    });
    page.on('response', (r) => {
      if (r.status() >= 400 && !HOST_URLS.test(r.url())) errors.push(`${r.status()} ${r.url()}`);
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
          await page.getByRole('tab', { name: /^All/ }).click();
          await page.getByRole('article').first().waitFor();
          await shot('threads-all');
          await page.getByRole('tab', { name: /Outdated/ }).click();
          await page.getByText(/outdated · was/).first().waitFor();
          await shot('threads-outdated');
        } else {
          await open(q({ review: range, file: 'a.js', view: 'threads' }), page.getByRole('tab', { name: /Outdated/ }));
          await page.getByRole('tab', { name: /^All/ }).click();
          await page.getByRole('article').first().waitFor();
          await shot('threads-all');
          await page.getByRole('tab', { name: /Outdated/ }).click();
          await page.getByText(/outdated · was/).first().waitFor();
          await shot('threads-outdated');
        }

        await open(q({ review: range, file: 'logo.bin' }), page.getByText('Binary file changed'));
        await shot('binary-file');

        await open(q({ review: range }), page.getByRole('button', { name: 'Submit round' }));
        await page.getByRole('button', { name: 'Submit round' }).click();
        await page.getByRole('dialog').waitFor();
        await page.getByLabel('Prompt').waitFor();
        await shot('submit-dialog');
        await page.getByRole('button', { name: 'Close' }).first().click();

        await open(q({ review: uncommitted, file: 'a.js' }), page.getByRole('grid'));
        await page.getByRole('article').first().waitFor();
        await shot('uncommitted');
      }
    }
    if (errors.length) throw new Error(`unexpected console errors:\n${errors.join('\n')}`);
  }, { headless: true, viewport: VIEWPORTS.desktop });
} finally {
  await world.close();
}
