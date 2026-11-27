// File tree check: every file row is one line with its green/red +/− counts visible beside a truncating name, folders collapse behind a
// chevron button showing the count of files and summed +/− they hide, and opening a file expands its folders.
// Own seeded world (seed.mjs). Run: CC_PROJECTS_ROOT=<root> node harness/playwright/filetree.mjs   (needs `npm install` first, for frontend/dist)
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
const ONE_LINE_PX = 36;

const world = await seed();
const range = world.ids.range;
world.commit('feature', { 'frontend/src/features/files/FileTreeToolbar.tsx': 'export const x = 1;\n' });
await world.call('POST', `reviews/${range}/refresh`);
const OVERLONG = await world.longPath();
const url = (file) => `${world.url}/?${new URLSearchParams({ project: 'app', worktree: 'feature', review: range, ...(file ? { file } : {}) })}`;

function watchErrors(page) {
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !HOST_URLS.test(m.text()) && !/^Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  page.on('response', (r) => { if (r.status() >= 400 && !HOST_URLS.test(r.url())) errors.push(`${r.status()} ${r.url()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

/** Per file row: the counts' visibility and right edge against the row, overflow, height, and whether the name is truncated. */
const measureRows = (page) => page.evaluate(() => [...document.querySelectorAll('nav[aria-label="Files"] li')].filter((li) => li.querySelector(':scope > a')).map((li) => {
  const row = li.getBoundingClientRect();
  const counts = li.querySelector('[role=img][aria-label$=removed]');
  const cr = counts?.getBoundingClientRect();
  const a = li.querySelector('a');
  const name = [...a.querySelectorAll('span.truncate')][0];
  return {
    path: a.title, counts: counts?.getAttribute('aria-label') ?? null,
    countsVisible: !!cr && cr.width > 0 && cr.height > 0,
    countsInside: !!cr && cr.right <= row.right + 0.5 && cr.left >= row.left - 0.5,
    rowOverflow: li.scrollWidth > li.clientWidth,
    height: Math.round(row.height),
    nameTruncated: name.scrollWidth > name.clientWidth,
    greenRed: counts ? [...counts.children].map((c) => getComputedStyle(c).color) : [],
  };
}));

const CONFIGS = [
  { name: '1280', width: 1280, height: 800, open: true },
  { name: '992', width: 992, height: 800, open: true },
  { name: '900-pane512', width: 900, height: 800, pane: '512', open: true },
  { name: '768', width: 768, height: 844 },
  { name: '390', width: 390, height: 844, truncates: true },
  { name: '320', width: 320, height: 844, truncates: true },
  { name: '1280-pane288', width: 1280, height: 800, pane: '288', truncates: true },
];

await withPage(async (_page, { browser }) => {
  for (const cfg of CONFIGS) {
    for (const scheme of ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport: { width: cfg.width, height: cfg.height }, colorScheme: scheme });
      const page = await ctx.newPage();
      const errors = watchErrors(page);
      if (cfg.pane) await page.addInitScript((w) => localStorage.setItem('code-review:sidePaneWidth', w), cfg.pane);
      const label = `${cfg.name}/${scheme}`;
      await page.goto(url());
      await page.locator('nav[aria-label="Files"] a').first().waitFor();
      const rows = await measureRows(page);
      assert.ok(rows.length >= 4, `${label}: several file rows`);
      for (const r of rows) {
        const counts = r.countsVisible ? r.counts : 'none';
        console.log(`${label} ${r.path.slice(-40)}: counts ${counts}, height ${r.height}px, name truncated ${r.nameTruncated}`);
        if (r.path === 'logo.bin') { assert.ok(!r.countsVisible, `${label}: a binary file with no line changes shows no counts`); continue; }
        assert.ok(r.countsVisible, `${label} ${r.path}: the +/− counts are visible`);
        assert.ok(r.countsInside, `${label} ${r.path}: the counts lie inside the row`);
        assert.ok(!r.rowOverflow, `${label} ${r.path}: the row does not scroll sideways`);
        assert.ok(r.height <= ONE_LINE_PX, `${label} ${r.path}: the row is one line (${r.height}px)`);
        assert.equal(r.greenRed.length, 2, `${label} ${r.path}: two coloured counts`);
        assert.notEqual(r.greenRed[0], r.greenRed[1], `${label} ${r.path}: added and removed differ in colour`);
      }
      if (cfg.truncates) assert.ok(rows.find((r) => r.path === OVERLONG).nameTruncated, `${label}: the long name truncates`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label}: the page does not scroll sideways`);
      await page.screenshot({ path: path.join(outDir, `filetree-${cfg.name}-${scheme}.png`), animations: 'disabled' });

      // Collapse packages/: the row stands in for its files.
      const folder = page.getByRole('button', { name: /^packages\// });
      await folder.click();
      assert.equal(await folder.getAttribute('aria-expanded'), 'false', `${label}: packages/ collapsed`);
      const text = await folder.textContent();
      const agg = await folder.locator('[role=img]').getAttribute('aria-label');
      console.log(`${label}: collapsed row "${text}" (${agg})`);
      assert.match(text, /^packages\/\d+ files?/, `${label}: the collapsed row names its file count`);
      assert.equal(await page.locator('nav[aria-label="Files"] a[title^="packages/"]').count(), 0, `${label}: its files are hidden`);
      const fr = await folder.evaluate((el) => { const r = el.getBoundingClientRect(); const c = el.querySelector('[role=img]').getBoundingClientRect(); return { h: r.height, inside: c.right <= r.right + 0.5, over: el.scrollWidth > el.clientWidth }; });
      assert.ok(fr.inside && !fr.over && fr.h <= ONE_LINE_PX, `${label}: the collapsed folder row is one line with its counts inside`);
      await page.screenshot({ path: path.join(outDir, `filetree-${cfg.name}-${scheme}-collapsed.png`), animations: 'disabled' });

      if (cfg.open) {
        // Opening a file inside the collapsed folder (by route) expands its folders and marks it current.
        await page.goto(url(OVERLONG));
        await page.locator('nav[aria-label="Files"] a[aria-current]').waitFor();
        assert.equal(await page.getByRole('button', { name: /^packages\// }).getAttribute('aria-expanded'), 'true', `${label}: opening the file expands packages/`);
      }
      assert.deepEqual(errors, [], label);
      await ctx.close();
    }
  }
}, { headless: true });
await world.close();
console.log('filetree: ok');
