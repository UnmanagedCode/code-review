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
// The last row before `el` in document order (thread cards and composers render below their row): its gutter
// `data-cell`s and its gridcell texts joined by `|`.
const rowBefore = (el) => el.evaluate((node) => {
  const row = [...document.querySelectorAll('[role="row"]')].filter((r) => r.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING).pop();
  return {
    cells: [...(row?.querySelectorAll('[data-cell]') ?? [])].map((c) => c.getAttribute('data-cell')),
    text: [...(row?.querySelectorAll('[role=gridcell]') ?? [])].map((c) => c.textContent).join('|'),
  };
});
const ACCEPTED_SUMMARY = /^@@.*accepted$/;

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

    // 1. Drag-select lines in the gutter: the release opens the composer directly. Post a question and see it under the last selected line.
    // Its first hunk is seeded accepted, so it starts collapsed; expand it.
    await page.goto(q({ review: range, file: 'a.js' }));
    await page.getByRole('button', { name: ACCEPTED_SUMMARY }).click();
    const cell = (n) => page.locator(`[data-cell="new:${n}"]`);
    await cell(10).scrollIntoViewIfNeeded();
    const [from, to] = [await cell(10).boundingBox(), await cell(11).boundingBox()];
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 6 });
    await page.mouse.up();
    await page.getByRole('form', { name: 'Comment on L10–L11 (new)' }).waitFor();
    assert.ok(await page.getByLabel('Message').evaluate((el) => el === document.activeElement), 'the release focuses the message');
    assert.equal(await page.getByRole('toolbar', { name: 'Selection' }).count(), 0, 'a mouse release shows no selection toolbar');
    await page.getByLabel('Kind').selectOption('question');
    await page.getByLabel('Message').fill('Is this loop bound right?');
    await shot('1-composer');
    await page.getByRole('button', { name: 'Post' }).click();
    const posted = page.locator('[role=rowgroup] article', { hasText: 'Is this loop bound right?' });
    await posted.waitFor();
    assert.ok((await rowBefore(posted)).cells.includes('new:11'), 'the question renders directly under line 11');
    await shot('1-posted');

    // 2. Accept a hunk; the tree tally follows.
    await page.goto(q({ review: range, file: 'c.js' }));
    const tree = page.getByRole('link', { name: /c\.js/ }).first();
    await tree.getByText('0 accepted, 0 rejected, 1 pending').waitFor();
    await page.getByRole('group', { name: 'Hunk verdict' }).first().getByRole('button', { name: 'Accept', exact: true }).click();
    await tree.getByText('1 accepted, 0 rejected, 0 pending').waitFor();
    await shot('2-accepted');

    // 2b. Accept file on a.js (seeded: one accepted, one rejected hunk). Clear the accepted one first so a hunk is pending;
    // Accept file then accepts it and leaves the rejected hunk rejected; the header and tree tallies follow.
    await page.goto(q({ review: range, file: 'a.js' }));
    const aTree = page.getByRole('link', { name: /a\.js/ }).first();
    const bars = page.getByRole('group', { name: 'Hunk verdict' });
    await aTree.getByText('1 accepted, 1 rejected, 0 pending').waitFor();
    await page.getByRole('button', { name: ACCEPTED_SUMMARY }).click();
    await bars.nth(0).getByRole('button', { name: 'Pending' }).click();
    await page.getByText('0/2 accepted · 1 rejected').waitFor();
    await aTree.getByText('0 accepted, 1 rejected, 1 pending').waitFor();
    await shot('2b-before-accept-file');
    await page.getByRole('button', { name: 'Accept file' }).click();
    await page.getByText('1/2 accepted · 1 rejected').waitFor();
    await aTree.getByText('1 accepted, 1 rejected, 0 pending').waitFor();
    // The accepted hunk collapses to its summary (no verdict bar); the rejected one stays expanded.
    await page.getByRole('button', { name: ACCEPTED_SUMMARY }).waitFor();
    assert.equal(await bars.count(), 1);
    assert.equal(await bars.nth(0).getByRole('button', { name: 'Reject', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.getByRole('button', { name: 'Accept file' }).isDisabled(), true);
    await shot('2b-accepted-file');

    // 3. Submit round without a bridge: copy dialog, Mark as sent, header says submitted.
    await page.getByRole('button', { name: 'Submit round' }).click();
    await page.getByLabel('Prompt').waitFor();
    await shot('3-copy-dialog');
    await page.getByRole('button', { name: 'Mark as sent' }).click();
    await page.getByText(/Round 2 · submitted/).waitFor();
    await shot('3-submitted');

    // 3b. The recipient picker names the untitled s-rev by cc's label; choosing it puts that label in the header.
    await page.getByRole('button', { name: /^Recipient:/ }).click();
    const recipientSelect = page.getByRole('dialog').getByLabel('Session');
    await recipientSelect.getByRole('option', { name: 'Review the feature branch' }).waitFor({ state: 'attached' });
    await recipientSelect.selectOption({ label: 'Review the feature branch' });
    await page.getByRole('button', { name: 'Save' }).click();
    await page.getByRole('button', { name: 'Recipient: Review the feature branch' }).waitFor();
    await shot('3b-recipient-untitled');

    // 5. Pick round 1: read-only, and the question that is outdated now sits under its round-1 lines again.
    // Back to the current round, it is gone from the diff.
    await page.getByRole('combobox', { name: 'Round' }).selectOption('1');
    await page.getByRole('button', { name: 'Back to current round' }).waitFor();
    await page.getByRole('link', { name: /a\.js/ }).first().click();
    const question = page.locator('[role=rowgroup] article', { hasText: 'Why change both lines?' });
    await question.waitFor();
    // Read-only rows carry no data-cell (no gutter selection): match the row by its new-side number and text.
    const atLine4 = (await rowBefore(question)).text;
    assert.equal(atLine4, '|4|+|changed4', 'in round 1 the question renders under new line 4, its last line then');
    assert.equal(await page.getByRole('group', { name: 'Hunk verdict' }).count(), 0, 'no verdict controls in a past round');
    assert.equal(await page.getByLabel('Reply').count(), 0, 'no reply box in a past round');
    await shot('5-round-1');
    await page.getByRole('button', { name: 'Back to current round' }).click();
    await page.getByRole('combobox', { name: 'Commit filter' }).waitFor();
    assert.ok(!new URL(page.url()).searchParams.has('round'));
    await page.getByRole('link', { name: /a\.js/ }).first().click();
    await page.getByRole('group', { name: 'Hunk verdict' }).first().waitFor();
    assert.equal(await question.count(), 0, 'the outdated question is not in the current diff');
    await shot('5-back-to-current');

    // 5c. Compare rounds (1 → 2): round 1's question sits on the left at its round-1 lines, noted outdated in round 2;
    // the comment on line 9 (unchanged in both rounds) shows once; nothing is writable.
    await page.getByRole('button', { name: 'Compare rounds' }).click();
    await page.getByRole('button', { name: 'Exit comparison' }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('compare'), '1..2');
    await page.getByRole('link', { name: /a\.js/ }).first().click();
    await question.waitFor();
    assert.equal((await rowBefore(question)).text, '4||−|changed4', 'inline, the question sits under round 1\'s line 4 (deleted in round 2)');
    assert.match(await question.textContent(), /outdated in round 2/);
    assert.equal(await page.locator('[role=rowgroup] article', { hasText: 'Fine, but add a test.' }).count(), 1, 'the comment on a line both rounds share shows once');
    assert.equal(await page.getByRole('group', { name: 'Hunk verdict' }).count(), 0, 'no verdict controls in a comparison');
    assert.equal(await page.getByLabel('Reply').count(), 0, 'no reply box in a comparison');
    assert.equal(await page.getByRole('button', { name: 'Submit round' }).count(), 0, 'no Submit in a comparison');
    await shot('5c-compare-inline');

    // 5d. Split (needs a 36rem pane: md–xl width): the question is under the pair whose left number is 4.
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.getByRole('group', { name: 'Diff view' }).getByRole('button', { name: 'Split' }).click();
    await page.locator('[role=row].grid').first().waitFor();
    assert.match((await rowBefore(question)).text, /^4\|−\|changed4\|/, 'split, the question is under the pair whose left number is 4');
    const compareOverflow = await page.getByRole('grid').evaluate((g) => g.scrollWidth - g.clientWidth);
    assert.ok(compareOverflow <= 0, `the split comparison has no horizontal overflow (${compareOverflow}px)`);
    await shot('5c-compare-split');

    // 5e. The threads sheet lists the base-side finding under Not in diff; Exit comparison leaves it.
    await page.getByRole('button', { name: /^Threads/ }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByRole('tab', { name: /^Not in diff/ }).click();
    const unplaced = sheet.getByRole('tabpanel').locator('article', { hasText: 'Missing guard' });
    await unplaced.waitFor();
    assert.match(await unplaced.textContent(), /on the base side/);
    await shot('5e-compare-not-in-diff');
    await page.keyboard.press('Escape');
    await sheet.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Exit comparison' }).click();
    await page.getByRole('combobox', { name: 'Commit filter' }).waitFor();
    assert.ok(!new URL(page.url()).searchParams.has('compare'));
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

    // 4b: the active session's checkouts lead each select; New review prefills from it, and a typed title survives a session change.
    const groups = (id) => page.evaluate((i) => [...document.querySelectorAll(`#${i} optgroup`)].map((g) => [g.label, [...g.querySelectorAll('option')].map((o) => o.textContent)]), id);
    assert.deepEqual(await groups('cb-project'), [['Active session', ['app']], ['Other projects', ['other']]]);
    assert.deepEqual(await groups('cb-worktree'), [['Active session', ['feature']], ['Other worktrees', ['Main checkout']]]);
    await page.getByRole('button', { name: 'New review' }).click();
    const title = page.getByLabel('Title (optional)');
    const recipient = page.getByLabel('Recipient session');
    await page.waitForFunction(() => document.querySelector('#nr-recipient')?.value === 's-author');
    assert.equal(await title.inputValue(), 's-author');
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await shot(`4b-new-review-prefilled-${scheme}`);
    }
    await page.emulateMedia({ colorScheme: 'light' });
    await title.fill('My title');
    await page.evaluate(() => window.__emit({ sessionId: 's-rev', project: 'app', worktree: 'feature' }));
    await page.waitForFunction(() => document.querySelector('#nr-recipient')?.value === 's-rev');
    assert.equal(await title.inputValue(), 'My title');
    assert.equal(await recipient.inputValue(), 's-rev');
    await shot('4b-new-review-title-kept');
    await page.keyboard.press('Escape');
    assert.deepEqual(await groups('cb-project'), [['Active session', ['app', 'other']]]);
    assert.deepEqual(await groups('cb-worktree'), [['Active session', ['Main checkout']], ['Other worktrees', ['feature']]]);

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
  // 6–10: split view, collapsed settled items, the resizable thread panel (stored view/width live in this page's storage).
  await withPage(async (page) => {
    const errors = watchErrors(page);
    const shot = shotter(page);
    const grid = page.getByRole('grid');
    const viewGroup = page.getByRole('group', { name: 'Diff view' });
    const isSplit = () => page.locator('[role=row].grid').count().then((n) => n > 0);
    const accepted = page.getByRole('button', { name: ACCEPTED_SUMMARY });

    // 6. Accepted hunk collapsed (inline), then Split: the long line wraps instead of overflowing; the choice survives a reload.
    await page.goto(q({ review: range, file: 'a.js' }));
    await accepted.waitFor();
    assert.equal(await page.locator('[data-cell="new:6"]').count(), 0, 'the accepted hunk hides its lines');
    await shot('6-collapsed-inline');
    await viewGroup.getByRole('button', { name: 'Split' }).click();
    await accepted.click();
    await page.locator('[data-cell="new:6"]').waitFor();
    assert.ok(await isSplit(), 'split rows render');
    const overflow = await grid.evaluate((g) => g.scrollWidth - g.clientWidth);
    assert.ok(overflow <= 0, `split has no horizontal overflow (${overflow}px)`);
    await shot('6-split');
    await page.reload();
    await accepted.click();
    assert.equal(await viewGroup.getByRole('button', { name: 'Split' }).getAttribute('aria-pressed'), 'true', 'split is remembered');

    // 7. Drag-select on the right (new) gutter: the composer opens under the pair row holding the last line.
    const cell = (n) => page.locator(`[data-cell="new:${n}"]`);
    await cell(6).scrollIntoViewIfNeeded();
    const [from, to] = [await cell(5).boundingBox(), await cell(6).boundingBox()];
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 6 });
    await page.mouse.up();
    const form = page.getByRole('form', { name: 'Comment on L5–L6 (new)' });
    await form.waitFor();
    assert.ok((await rowBefore(form)).cells.includes('new:6'), 'the composer renders under the pair row holding new line 6');
    await shot('7-split-composer');
    await form.getByRole('button', { name: 'Cancel' }).click();

    // 8. Resolve the open finding: it collapses to a summary, in both views.
    const finding = page.locator('[role=rowgroup] article', { hasText: 'Missing guard' });
    await finding.getByRole('button', { name: 'Resolve as fixed' }).click();
    const findingSummary = page.getByRole('button', { name: /Missing guard.*resolved/ });
    await findingSummary.waitFor();
    assert.equal(await findingSummary.getAttribute('aria-expanded'), 'false');
    await shot('8-resolved-split');
    await viewGroup.getByRole('button', { name: 'Inline' }).click();
    await findingSummary.waitFor();
    await findingSummary.click();
    await finding.waitFor();
    await shot('8-resolved-expanded-inline');
    await viewGroup.getByRole('button', { name: 'Split' }).click();

    // 9. Phone: the stored split choice gives way to inline, with no toggle.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(q({ review: range, file: 'a.js' }));
    await grid.waitFor();
    assert.equal(await viewGroup.count(), 0, 'no view toggle on a phone');
    assert.equal(await isSplit(), false, 'a phone shows inline rows');
    await shot('9-phone-inline');

    // 9b. A comparison on a phone: inline rows, round 1's question under its round-1 line 4.
    await page.goto(q({ review: range, compare: '1..2', file: 'a.js' }));
    const phoneQuestion = page.locator('[role=rowgroup] article', { hasText: 'Why change both lines?' });
    await phoneQuestion.waitFor();
    assert.equal(await isSplit(), false, 'a phone comparison shows inline rows');
    assert.equal((await rowBefore(phoneQuestion)).text, '4||−|changed4');
    await shot('9b-phone-compare');

    // 10. xl: the thread column has a handle; widening it pushes split down to inline, narrowing brings it back.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(q({ review: range, file: 'a.js' }));
    const handle = page.getByRole('separator', { name: 'Resize threads panel' });
    await handle.waitFor();
    await viewGroup.waitFor();
    assert.ok(await isSplit(), 'the default panel leaves room for split at 1440px');
    const panelWidth = () => handle.evaluate((h) => h.parentElement.getBoundingClientRect().width);
    const before = await panelWidth();
    const drag = async (dx) => {
      const b = await handle.boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2, { steps: 8 });
      await page.mouse.up();
    };
    await drag(-200);
    assert.equal(await panelWidth(), before + 200, 'dragging left widens the panel');
    await viewGroup.waitFor({ state: 'detached' });
    assert.equal(await isSplit(), false, 'the narrower diff pane falls back to inline');
    await shot('10-wide-panel-inline');
    await drag(200);
    await viewGroup.waitFor();
    assert.ok(await isSplit(), 'narrowing the panel brings split back');
    await handle.focus();
    await page.keyboard.press('End');
    const pane = await page.getByRole('main').evaluate((m) => m.getBoundingClientRect().width);
    assert.ok(pane >= 384, `the diff pane keeps its minimum (${pane}px)`);
    const widest = await panelWidth();
    await shot('10-panel-max');
    await page.reload();
    await handle.waitFor();
    assert.equal(await panelWidth(), widest, 'the panel width survives a reload');

    // 11. Below xl the threads sheet overlays the diff and has no handle.
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(q({ review: range, file: 'a.js' }));
    await page.getByRole('button', { name: /^Threads/ }).click();
    await page.getByRole('dialog').waitFor();
    assert.equal(await page.getByRole('separator', { name: 'Resize threads panel' }).count(), 0, 'the md sheet has no handle');
    await shot('11-md-sheet');
    assert.deepEqual(errors, []);
  }, { headless: true, viewport: { width: 1100, height: 800 } }); // md–xl: a 320px file column leaves a split-wide pane
  // 12: an outdated thread's link opens its comparison; Focus on a thread of another file opens that file.
  await withPage(async (page) => {
    const errors = watchErrors(page);
    const shot = shotter(page);
    await page.goto(q({ review: range, file: 'a.js' }));
    await page.getByRole('tab', { name: /^Outdated/ }).click();
    await shot('12a-outdated-link');
    await page.getByRole('button', { name: /^a\.js:\d+$/ }).click();
    await page.getByText('Exit comparison').waitFor();
    assert.match(page.url(), /compare=1\.\.2/, 'the outdated thread opens its round and the next');
    await page.locator('article[aria-label$="thread"]').first().waitFor();
    await shot('12b-outdated-comparison');
    await page.getByRole('button', { name: 'Exit comparison' }).click();
    await page.goto(q({ review: range, file: 'c.js' }));
    await page.getByRole('tab', { name: /^All/ }).click();
    const card = page.getByRole('article').filter({ has: page.getByRole('button', { name: /^a\.js:\d+$/ }) }).first();
    await card.getByRole('button', { name: 'Focus' }).click();
    await page.getByRole('grid', { name: 'Changes in a.js' }).waitFor();
    assert.match(page.url(), /file=a\.js/);
    await shot('12c-cross-file-focus');
    assert.deepEqual(errors, []);
  }, { headless: true, viewport: { width: 1400, height: 900 } });
  console.log('golden path ok');
} finally {
  await world.close();
}
