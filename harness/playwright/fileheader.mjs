// File header check: the base name stays whole when the path is long, the directory elides from the left, the status is the tree's letter,
// and no header grows taller or overflows, at the widths the plugin meets (inside cc, standalone, narrow pane, phones).
// Own seeded world (seed.mjs), so other harnesses' counts don't move.
// Run: node harness/playwright/fileheader.mjs   (needs `npm install` first, for frontend/dist)
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
const HEADER = 'div.sticky.top-0.z-10';

const world = await seed();
const range = world.ids.range;
const REALISTIC = 'frontend/src/features/files/FileTreeToolbar.tsx';
world.commit('feature', { [REALISTIC]: 'export const x = 1;\n' });
await world.call('POST', `reviews/${range}/refresh`);
const OVERLONG = await world.longPath();
const SHORT = 'a.js';
const url = (file) => `${world.url}/?${new URLSearchParams({ project: 'app', worktree: 'feature', review: range, file })}`;

function watchErrors(page) {
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !HOST_URLS.test(m.text()) && !/^Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  page.on('response', (r) => { if (r.status() >= 400 && !HOST_URLS.test(r.url())) errors.push(`${r.status()} ${r.url()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

/** Contrast of `sel`'s text colour on its ancestors' composited backgrounds (canvas paint, since the colours are oklch strings). */
const contrastOf = (locator) => locator.evaluate((el) => {
  const ctx = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
  const paint = (colors) => { ctx.clearRect(0, 0, 1, 1); for (const c of colors) { ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); } return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)]; };
  const lum = (rgb) => { const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const layers = [];
  for (let n = el; n; n = n.parentElement) { const bg = getComputedStyle(n).backgroundColor; if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') layers.unshift(bg); }
  const [a, b] = [lum(paint([...layers, getComputedStyle(el).color])), lum(paint(layers))];
  return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
});

/** The path's measurements and the overflow checks for the open file. */
const measure = (page) => page.evaluate(() => {
  const header = document.querySelector('div.sticky.top-0.z-10');
  const box = header.querySelector('p[title]');
  const base = box.querySelector('[data-path-base]');
  const dir = box.querySelector('[data-path-dir]');
  const main = document.querySelector('main');
  const edge = main.getBoundingClientRect().right;
  const hr = header.getBoundingClientRect();
  const br = base.getBoundingClientRect();
  return {
    title: box.title, text: box.textContent,
    box: Math.round(box.getBoundingClientRect().width),
    base: { client: base.clientWidth, scroll: base.scrollWidth, inside: br.left >= hr.left - 0.5 && br.right <= hr.right + 0.5 },
    dir: dir ? { client: dir.clientWidth, scroll: dir.scrollWidth, text: dir.textContent } : null,
    height: Math.round(hr.height),
    headerFits: header.scrollWidth <= header.clientWidth,
    cut: [...header.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().width && b.getBoundingClientRect().right > edge + 0.5).map((b) => b.getAttribute('aria-label') || b.textContent),
    docFits: document.documentElement.scrollWidth <= innerWidth,
  };
});

const CONFIGS = [
  { name: '992', width: 992, height: 800 },
  { name: '1280', width: 1280, height: 800 },
  { name: '900-pane512', width: 900, height: 800, pane: '512' },
  { name: '768', width: 768, height: 844 },
  { name: '390', width: 390, height: 844 },
  { name: '390-touch', width: 390, height: 844, touch: true },
  { name: '320', width: 320, height: 844 },
];
// The seeded files are added or modified; the sr-only word names whichever it is.
const STATUS_WORD = /^(added|modified|deleted|renamed)$/;
const WHOLE_AT = new Set(['992', '1280', '390']);

await withPage(async (_page, { browser }) => {
  const heights = {};
  for (const cfg of CONFIGS) {
    for (const scheme of ['light', 'dark']) {
      if (scheme === 'dark' && !['992', '390'].includes(cfg.name)) continue;
      const ctx = await browser.newContext({ viewport: { width: cfg.width, height: cfg.height }, hasTouch: !!cfg.touch, colorScheme: scheme });
      const page = await ctx.newPage();
      const errors = watchErrors(page);
      if (cfg.pane) await page.addInitScript((w) => localStorage.setItem('code-review:sidePaneWidth', w), cfg.pane);
      const label = `${cfg.name}/${scheme}`;
      for (const [kind, file] of [['short', SHORT], ['realistic', REALISTIC], ['overlong', OVERLONG]]) {
        await page.goto(url(file));
        await page.locator(`${HEADER} p[title]`).waitFor();
        const m = await measure(page);
        const key = `${cfg.name}/${scheme}`;
        console.log(`${label} ${kind}: path box ${m.box}px, base ${m.base.client}/${m.base.scroll}px, dir ${m.dir ? `${m.dir.client}/${m.dir.scroll}px` : '-'}, header ${m.height}px`);
        // 4. The full path is available as the title and as the text.
        assert.equal(m.title, file, `${label} ${kind}: the title is the full path`);
        assert.equal(m.text, file, `${label} ${kind}: the text is the full path`);
        // 2. The directory gives way first.
        if (m.base.scroll > m.base.client) assert.equal(m.dir?.client ?? 0, 0, `${label} ${kind}: the base name is cut only once the directory is gone`);
        // 1. The base name is whole.
        if (kind === 'realistic' && WHOLE_AT.has(cfg.name)) {
          assert.ok(m.base.scroll <= m.base.client, `${label}: FileTreeToolbar.tsx is whole`);
          assert.ok(m.base.inside, `${label}: the base name lies inside the header`);
        }
        // 3. Leading ellipsis at 992.
        if (kind === 'realistic' && cfg.name === '992') {
          assert.ok(m.dir.scroll > m.dir.client && m.dir.client > 0, `${label}: the directory is truncated, not gone`);
          assert.equal(m.dir.text, 'frontend/src/features/files/');
        }
        // 5/6. No overflow.
        assert.ok(m.headerFits, `${label} ${kind}: the header does not scroll sideways`);
        assert.deepEqual(m.cut, [], `${label} ${kind}: no header control is cut off`);
        assert.ok(m.docFits, `${label} ${kind}: the page does not scroll sideways`);
        // 5. No height change against the short control at the same width.
        if (kind === 'short') heights[key] = m.height;
        else assert.equal(m.height, heights[key], `${label} ${kind}: the header is as tall as with a short path`);
        if (kind !== 'short' && ['992', '390', '1280', '900-pane512', '320'].includes(cfg.name)) await page.screenshot({ path: path.join(outDir, `fileheader-${cfg.name}-${scheme}-${kind}.png`), animations: 'disabled' });
        if (kind === 'realistic') {
          // 7. The status letter's contrast.
          const letter = page.locator(HEADER).locator('.sr-only', { hasText: STATUS_WORD }).locator('..');
          if (['992', '390'].includes(cfg.name)) {
            const c = await contrastOf(letter);
            console.log(`${label}: header letter contrast ${c}`);
            assert.ok(c >= 4.5, `${label}: the header letter reaches 4.5:1 (${c})`);
          }
          if (cfg.name === '992') {
            const rows = page.locator('nav[aria-label="Files"] li');
            const sel = rows.filter({ has: page.locator('a[aria-current]') }).first().locator('.sr-only').locator('..');
            const plain = rows.filter({ hasNot: page.locator('a[aria-current]') }).first().locator('.sr-only').locator('..');
            for (const [n, l] of [['selected', sel], ['plain', plain]]) {
              const c = await contrastOf(l);
              console.log(`${label}: tree letter (${n} row) contrast ${c}`);
              assert.ok(c >= 4.5, `${label}: the tree letter on a ${n} row reaches 4.5:1 (${c})`);
            }
            // 4. The tooltip names the status (fine pointer).
            if (scheme === 'light') {
              await page.locator(HEADER).locator('.sr-only', { hasText: STATUS_WORD }).locator('..').hover();
              await page.getByRole('tooltip').first().waitFor();
              assert.match((await page.getByRole('tooltip').first().textContent()).trim(), STATUS_WORD);
            }
          }
        }
      }
      assert.deepEqual(errors, [], label);
      await ctx.close();
    }
  }
}, { headless: true });
await world.close();
console.log('fileheader: ok');
