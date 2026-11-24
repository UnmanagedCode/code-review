// Keyboard navigation check: thread/file/hunk stepping, the verdict keys, the `?` overlay and the tooltips, at desktop and phone width.
// Own seeded world (seed.mjs plus the threads below), so golden's and snap's counts don't move.
// Run: node harness/playwright/jumpnav.mjs   (needs `npm install` first, for frontend/dist)
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
const { guided } = world.ids;
const { call, mcp } = world;
const author = { sessionId: 's-author' };
const q = (o) => `${world.url}/?${new URLSearchParams({ project: 'app', worktree: 'guided', review: guided, ...o })}`;

function watchErrors(page) {
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !HOST_URLS.test(m.text()) && !/^Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  page.on('response', (r) => { if (r.status() >= 400 && !HOST_URLS.test(r.url())) errors.push(`${r.status()} ${r.url()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}
const STUB_BRIDGE = () => {
  window.ccBridge = { session: undefined, sent: [], onSession(fn) { return () => {}; }, async openSession() { return { ok: true }; }, async sendPrompt(id, text) { window.ccBridge.sent.push([id, text]); return { ok: true }; } };
};
const params = (page) => Object.fromEntries(new URL(page.url()).searchParams);
const shotter = (page) => async (name) => {
  const file = path.join(outDir, `jumpnav-${name}.png`);
  await page.screenshot({ path: file, animations: 'disabled' });
  console.log(`screenshot: ${file}`);
};
const HEADER = 'div.sticky.top-0.z-10';
const histLen = (page) => page.evaluate(() => history.length);
const blur = (page) => page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
/** Presses `key` with focus on the page body, and waits for the app to settle. */
const press = async (page, key) => { await page.keyboard.press(key); await page.waitForTimeout(250); };
const active = (page) => page.evaluate(() => {
  const el = document.activeElement;
  return { tag: el?.tagName, label: el?.getAttribute('aria-label'), hunk: el?.getAttribute('data-hunk-id'), article: !!el?.closest('article'), top: el?.getBoundingClientRect().top };
});

// Seed: open threads on the guided review's three files, then agent replies so some need the human.
const post = async (anchor, body) => (await call('POST', `reviews/${guided}/threads`, { anchor, kind: 'comment', body })).thread.id;
const g1L50 = await post({ kind: 'lines', file: 'g1.js', side: 'new', startLine: 50, endLine: 50 }, 'Check g1 line 50.');
const g2L5 = await post({ kind: 'lines', file: 'g2.js', side: 'new', startLine: 5, endLine: 5 }, 'Check g2 line 5.');
const g2Old = await post({ kind: 'lines', file: 'g2.js', side: 'old', startLine: 5, endLine: 5 }, 'Was this old line needed?');
const g2File = await post({ kind: 'file', file: 'g2.js' }, 'Whole-file remark on g2.');
const g3L5 = await post({ kind: 'lines', file: 'g3.js', side: 'new', startLine: 5, endLine: 5 }, 'Check g3 line 5.');
const dead = await post({ kind: 'lines', file: 'g3.js', side: 'new', startLine: 6, endLine: 6 }, 'Resolved remark.');
await call('PATCH', `reviews/${guided}/threads/${dead}`, { status: 'resolved', disposition: 'dismissed' });
await mcp('reply', { review: guided, thread: g3L5, body: 'Looked at it.' }, author);
await mcp('reply', { review: guided, thread: g2File, body: 'Noted.' }, author);
await mcp('reply', { review: guided, thread: g2Old, body: 'Removed it. Resolving.', resolve: true }, author);
// Needs you (place order): g2 file, g2 old line, g3 line 5, then the seeded group thread. The rest: g1 line 50, g2 line 5.
const needs = [g2File, g2Old, g3L5];
const rest = [g1L50, g2L5];

try {
  await withPage(async (page) => {
    const errors = watchErrors(page);
    const shot = shotter(page);
    await page.addInitScript(STUB_BRIDGE);

    // 1. The two-row header with the steppers, labelled Comment and Options, and File 2 of 3.
    await page.goto(q({ file: 'g2.js' }));
    await page.getByText('File 2 of 3').waitFor();
    await page.getByRole('button', { name: 'Comment on file' }).waitFor();
    assert.ok(await page.getByRole('button', { name: /^Diff options/ }).textContent().then((t) => /Options/.test(t)), 'Options is labelled');
    assert.ok(await page.getByText(/^6 open threads$/).count(), 'the thread stepper counts the six open threads');
    await shot('stepper-desktop');

    // 2. n visits the needs-you threads first, in place order, then the rest; history grows only on file changes.
    const files = [];
    let len = await histLen(page);
    const visit = async (key) => {
      await press(page, key);
      const p = params(page);
      const grew = (await histLen(page)) - len;
      len = await histLen(page);
      return { p, grew };
    };
    let step = await visit('n');
    assert.equal(step.p.thread, g2File); assert.equal(step.p.file, 'g2.js'); assert.equal(step.grew, 0, 'a same-file step replaces history');
    assert.equal((await active(page)).article, true, 'the routed card takes focus');
    await page.getByText('Thread 1 of 6 open').waitFor();
    step = await visit('n'); assert.equal(step.p.thread, g2Old); assert.equal(step.grew, 0);
    step = await visit('n'); assert.equal(step.p.thread, g3L5); assert.equal(step.p.file, 'g3.js'); assert.equal(step.grew, 1, 'a cross-file step pushes');
    step = await visit('n'); assert.equal(step.p.view, 'guided'); assert.equal(step.p.file, undefined, 'the group thread leaves the file');
    await page.getByRole('tab', { name: /Guided/ }).waitFor();
    step = await visit('n'); assert.equal(step.p.thread, g1L50); assert.equal(step.p.file, 'g1.js');
    step = await visit('n'); assert.equal(step.p.thread, g2L5); assert.equal(step.p.file, 'g2.js');
    const end = page.url();
    await press(page, 'n');
    assert.equal(page.url(), end, 'n stops at the last thread');
    await page.getByText('Thread 6 of 6 open').waitFor();
    void files; void rest;

    // 3. Reply in a needs-you thread, then n reaches the next needs-you thread (the remembered slot).
    await page.goto(q({ file: 'g2.js' }));
    await page.getByText('File 2 of 3').waitFor();
    await press(page, 'n');
    assert.equal(params(page).thread, g2File);
    const card = page.locator('article:visible', { hasText: 'Whole-file remark on g2' });
    await card.getByLabel('Reply').fill('Thanks, understood.');
    await card.getByRole('button', { name: 'Reply', exact: true }).click();
    await page.getByText('Will be sent').first().waitFor();
    await blur(page);
    await press(page, 'n');
    assert.equal(params(page).thread, g2Old, 'the next needs-you thread, not the one after the first tier');

    // 4. u wraps through the needs-you threads, p reverses, ] and [ follow tree order.
    await press(page, 'u'); assert.equal(params(page).thread, g3L5);
    await press(page, 'u'); assert.equal(params(page).view, 'guided');
    await press(page, 'u'); assert.equal(params(page).thread, g2Old, 'u wraps');
    await press(page, 'n'); assert.equal(params(page).thread, g3L5);
    await press(page, 'p'); assert.equal(params(page).thread, g2Old);
    await press(page, ']'); assert.equal(params(page).file, 'g3.js'); assert.equal(params(page).thread, undefined);
    await press(page, '['); assert.equal(params(page).file, 'g2.js');
    await press(page, '['); assert.equal(params(page).file, 'g1.js');
    await press(page, ']');

    // 5. j and k land a hunk region just under the sticky header (a short window, so the page can scroll that far).
    await page.setViewportSize({ width: 1280, height: 340 });
    await page.goto(q({ file: 'g2.js' }));
    await page.getByText('File 2 of 3').waitFor();
    await press(page, 'j'); // hunk 1 starts below the header (the file's thread block sits above it)
    assert.match((await active(page)).label, /^Hunk 1 of 2: /);
    await press(page, 'j');
    let at = await active(page);
    assert.match(at.label, /^Hunk 2 of 2: /);
    const bottom = await page.locator(HEADER).evaluate((el) => el.getBoundingClientRect().bottom);
    assert.ok(Math.abs(at.top - bottom) <= 2, `hunk 2 sits ${at.top - bottom}px from the header's bottom edge`);
    await page.getByText('Hunk 2 of 2').waitFor();
    await press(page, 'k');
    at = await active(page);
    assert.match(at.label, /^Hunk 1 of 2: /);
    await press(page, 'j');

    // 6. a decides the focused hunk and the toast's Undo restores it; x on a group's hunk is refused.
    await press(page, 'a');
    const region = page.locator('[data-hunk-id]:focus');
    await page.getByText('Hunk accepted').waitFor();
    await page.waitForFunction(() => /accepted/.test(document.activeElement?.textContent ?? ''));
    await page.getByRole('button', { name: 'Undo' }).click();
    await page.waitForFunction(() => !/accepted/.test(document.querySelector('[data-hunk-id]:last-of-type')?.textContent ?? 'accepted'));
    void region;
    await call('PUT', `reviews/${guided}/groups/g2/verdict`, { verdict: 'accepted' }); // g1.js's second hunk
    await page.goto(q({ file: 'g1.js' }));
    await page.getByText('File 1 of 3').waitFor();
    await press(page, 'j');
    await press(page, 'j');
    assert.match((await active(page)).label, /^Hunk 2 of 2: /);
    await page.waitForFunction(() => /accepted/.test(document.activeElement?.textContent ?? ''));
    await press(page, 'x');
    await page.getByText(/Part of “.*”, which is accepted/).waitFor();
    assert.match(await page.locator('[data-hunk-id]:focus').textContent(), /accepted/, 'the hunk keeps its verdict');

    // 7. Typing the shortcut letters into a reply box is text only.
    await page.goto(q({ file: 'g2.js' }));
    await page.getByText('File 2 of 3').waitFor();
    const url = page.url();
    const box = page.locator('textarea[aria-label=Reply]:visible').first();
    await box.click();
    await page.keyboard.type('npu][jkax?');
    assert.equal(await box.inputValue(), 'npu][jkax?');
    assert.equal(page.url(), url);
    assert.equal(await page.getByRole('dialog').count(), 0);
    await box.fill('');
    await blur(page);

    // 8. The tooltip names the key.
    await page.getByRole('button', { name: 'Previous file' }).hover();
    await page.getByRole('tooltip').waitFor();
    assert.equal((await page.getByRole('tooltip').textContent()).trim(), 'Previous file [');
    await page.mouse.move(600, 600);

    // 9–10. ? lists the registered shortcuts (no v or /), Esc closes it and focus returns to the opener.
    await page.setViewportSize({ width: 1280, height: 800 });
    const opener = page.getByRole('button', { name: 'Keyboard shortcuts' });
    await opener.focus();
    await press(page, '?');
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await dialog.waitFor();
    const listed = await dialog.locator('dt').allTextContents();
    for (const l of ['Next open thread', 'Next thread that needs you', 'Next hunk', 'Submit round', 'Overview']) assert.ok(listed.includes(l), `lists ${l}`);
    for (const l of ['Mark the file viewed', 'Filter files']) assert.ok(!listed.includes(l), `does not list ${l}`);
    await shot('overlay-desktop');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Keyboard shortcuts');

    // 11. o leaves the file; the overview's button lands on the first pending hunk.
    await call('PUT', `reviews/${guided}/groups/g1/verdict`, { verdict: 'accepted' }); // g1.js and g2.js's first hunks
    // The landing reads the verdicts the diff cache holds on arrival, so start from a fresh load after the out-of-band change.
    await page.reload();
    await page.getByText('File 2 of 3').waitFor();
    await blur(page);
    await press(page, 'o');
    assert.equal(params(page).file, undefined);
    const next = page.getByRole('button', { name: /Review next undecided hunk/ });
    await page.waitForFunction(() => /g2\.js/.test(document.querySelector('button[title$=".js"]')?.textContent ?? ''));
    await next.click();
    await page.waitForFunction(() => document.activeElement?.hasAttribute('data-hunk-id'));
    assert.equal(params(page).hunk, 'undecided');
    assert.match((await active(page)).label, /^Hunk 2 of 2: /, 'the first pending hunk of g2.js');

    // 12. s opens the recap and sends nothing.
    await blur(page);
    await press(page, 's');
    await page.getByRole('dialog').waitFor();
    assert.equal(await page.evaluate(() => window.ccBridge.sent.length), 0);
    await page.keyboard.press('Escape');
    assert.deepEqual(errors, []);
  }, { headless: true, viewport: { width: 1280, height: 800 } });

  await withPage(async (page) => {
    const errors = watchErrors(page);
    const shot = shotter(page);
    await page.goto(q({ file: 'g2.js' }));
    await page.getByText('File 2 of 3').waitFor();
    const clipped = await page.locator(HEADER).evaluate((el) => el.scrollWidth > el.clientWidth);
    assert.equal(clipped, false, 'the header does not scroll sideways at 390px');
    await shot('stepper-phone');
    await page.keyboard.press('?');
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await dialog.waitFor();
    assert.ok(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth), 'the overlay does not scroll sideways');
    await shot('overlay-phone');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Next thread' }).click();
    await page.waitForFunction(() => new URL(location.href).searchParams.has('thread'));
    assert.equal(params(page).thread, g2Old, 'the first needs-you thread (g2 file was answered in step 3)');
    assert.deepEqual(errors, []);
  }, { headless: true, viewport: { width: 390, height: 844 } });

  console.log('jumpnav ok');
} finally {
  await world.close();
}
