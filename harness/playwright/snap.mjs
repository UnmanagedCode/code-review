// Visual check of the UI: boots server.js on a free port, screenshots the page in
// light and dark (standalone, the page follows the emulated OS scheme), and fails
// on console errors other than the two host URLs that 404 outside cc.
// Run: node harness/playwright/snap.mjs   (needs `npm install` first, for frontend/dist)
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER } from './resolve.mjs';

const { bootServer, withPage } = await import(BROWSER);

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = path.join(projectRoot, 'harness', 'playwright', 'out');
mkdirSync(outDir, { recursive: true });

const HOST_URLS = /pluginBridge\.js|pluginTheme\.css/;

const srv = await bootServer({ cwd: projectRoot, entry: 'server.js' });
try {
  await withPage(async (page) => {
    const errors = [];
    // Chromium words a failed load as a generic "Failed to load resource" line with no URL, so
    // judge failures by response URL and ignore that line.
    page.on('console', (m) => {
      if (m.type() === 'error' && !HOST_URLS.test(m.text()) && !/^Failed to load resource/.test(m.text())) errors.push(m.text());
    });
    page.on('response', (r) => {
      if (r.status() >= 400 && !HOST_URLS.test(r.url())) errors.push(`${r.status()} ${r.url()}`);
    });
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(srv.url);
      await page.getByRole('heading', { name: 'Code Review' }).waitFor();
      const dark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
      if (dark !== (scheme === 'dark')) throw new Error(`${scheme}: html.dark is ${dark}`);
      const file = path.join(outDir, `home-${scheme}.png`);
      await page.screenshot({ path: file });
      console.log(`screenshot: ${file}`);
    }
    if (errors.length) throw new Error(`unexpected console errors:\n${errors.join('\n')}`);
  }, { headless: true, viewport: { width: 1280, height: 800 } });
} finally {
  await srv.close();
}
