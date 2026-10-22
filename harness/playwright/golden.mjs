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
// `data-cell`s and its gridcell texts joined by `|` (a read-only gutter's text includes the ranges it sits in).
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

    // 1c. Threads tab → All: the Owner filter splits the list into the user's threads and the agents'.
    await page.getByRole('tablist', { name: 'Review pane' }).getByRole('tab', { name: /^Threads/ }).click();
    const allPanel = page.getByRole('tabpanel', { name: /^Threads/ });
    await allPanel.getByRole('tab', { name: /^All/ }).click();
    await allPanel.getByLabel('Status').selectOption('all');
    const cards = allPanel.getByRole('article');
    await cards.first().waitFor();
    const everyone = await cards.count();
    await allPanel.getByLabel('Owner').selectOption('agents');
    await page.waitForFunction((n) => document.querySelectorAll('[role=tabpanel] article').length < n, everyone);
    const agents = await cards.count();
    await shot('1c-owner-agents');
    await allPanel.getByLabel('Owner').selectOption('user');
    await page.waitForFunction((n) => document.querySelectorAll('[role=tabpanel] article').length !== n, agents);
    assert.ok(agents > 0 && await cards.count() > 0 && agents + await cards.count() === everyone, 'owner splits the All list into agents + user');
    await shot('1c-owner-user');

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

    // 5. Pick round 1 in History: read-only, and the question that is outdated now sits under its round-1 lines again.
    // Back to the current round, it is gone from the diff.
    const paneTab = (name) => page.getByRole('tablist', { name: 'Review pane' }).getByRole('tab', { name });
    const scope = (re) => page.getByRole('button', { name: re });
    await paneTab('History').click();
    await page.getByRole('navigation', { name: 'History' }).getByRole('link', { name: /^Round 1 · / }).click();
    await page.getByRole('button', { name: 'Back to current round' }).waitFor();
    await scope(/^Round 1 · .* · read-only/).waitFor();
    await shot('5-history-round-1');
    await paneTab('Files').click();
    await page.getByRole('link', { name: /a\.js/ }).first().click();
    const question = page.locator('[role=rowgroup] article', { hasText: 'Why change both lines?' });
    await question.waitFor();
    // Read-only rows carry no data-cell (no gutter selection): match the row by its new-side number and text.
    const atLine4 = (await rowBefore(question)).text;
    assert.equal(atLine4, '|4 · in question thread L3–L4 (new)|+|changed4', 'in round 1 the question renders under new line 4, its last line then, and marks its range');
    assert.equal(await page.getByRole('group', { name: 'Hunk verdict' }).count(), 0, 'no verdict controls in a past round');
    assert.equal(await page.getByLabel('Reply').count(), 0, 'no reply box in a past round');
    await shot('5-round-1');
    await page.getByRole('button', { name: 'Back to current round' }).click();
    await scope(/^Round 2 · /).waitFor();
    assert.ok(!new URL(page.url()).searchParams.has('round'));
    await page.getByRole('link', { name: /a\.js/ }).first().click();
    await page.getByRole('group', { name: 'Hunk verdict' }).first().waitFor();
    assert.equal(await question.count(), 0, 'the outdated question is not in the current diff');
    await shot('5-back-to-current');

    // 5c. Compare rounds (1 → 2): round 1's question sits on the left at its round-1 lines, noted outdated in round 2;
    // the comment on line 9 (unchanged in both rounds) shows once; nothing is writable.
    await paneTab('History').click();
    await page.getByRole('button', { name: 'Compare rounds' }).click();
    await page.getByRole('button', { name: 'Exit comparison' }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('compare'), '1..2');
    await shot('5c-history-compare');
    await paneTab('Files').click();
    await page.getByRole('link', { name: /a\.js/ }).first().click();
    await question.waitFor();
    assert.equal((await rowBefore(question)).text, '4 · in question thread L3–L4 (old)||−|changed4', 'inline, the question sits under round 1\'s line 4 (deleted in round 2), marked on the old side');
    assert.match(await question.textContent(), /outdated in round 2/);
    assert.equal(await page.locator('[role=rowgroup] article', { hasText: 'Fine, but add a test.' }).count(), 1, 'the comment on a line both rounds share shows once');
    assert.equal(await page.getByRole('group', { name: 'Hunk verdict' }).count(), 0, 'no verdict controls in a comparison');
    assert.equal(await page.getByLabel('Reply').count(), 0, 'no reply box in a comparison');
    assert.equal(await page.getByRole('button', { name: 'Submit round' }).count(), 0, 'no Submit in a comparison');
    await shot('5c-compare-inline');

    // 5d. Split (needs a 36rem diff pane; 1100px less the default side pane leaves it): the question is under the pair whose left number is 4.
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.getByRole('group', { name: 'Diff view' }).getByRole('button', { name: 'Split' }).click();
    await page.locator('[role=row].grid').first().waitFor();
    assert.match((await rowBefore(question)).text, /^4 · in question thread L3–L4 \(old\)\|−\|changed4\|/, 'split, the question is under the pair whose left number is 4');
    const compareOverflow = await page.getByRole('grid').evaluate((g) => g.scrollWidth - g.clientWidth);
    assert.ok(compareOverflow <= 0, `the split comparison has no horizontal overflow (${compareOverflow}px)`);
    await shot('5c-compare-split');

    // 5e. The Threads tab lists the base-side finding under Not in diff; Exit comparison leaves it.
    await paneTab(/^Threads/).click();
    const threadsPanel = page.getByRole('tabpanel', { name: /^Threads/ });
    await threadsPanel.getByRole('tab', { name: /^Not in diff/ }).click();
    const unplaced = threadsPanel.getByRole('tabpanel').locator('article', { hasText: 'Missing guard' });
    await unplaced.waitFor();
    assert.match(await unplaced.textContent(), /on the base side/);
    await shot('5e-compare-not-in-diff');
    await page.getByRole('button', { name: 'Exit comparison' }).click();
    await scope(/^Round 2 · /).waitFor();
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
  // 6–11: split view, collapsed settled items, the resizable side pane (stored view/width live in this page's storage).
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
    // The resolved finding's summary keeps a readable preview at phone width: its range and badges wrap instead.
    // Checked at 390px and at a common 412px phone, whose summary is just wider than 24rem.
    const phoneSummary = page.getByRole('button', { name: /Missing guard.*resolved/ });
    const previewWidth = async () => (await phoneSummary.getByText('## Missing guard', { exact: true }).boundingBox()).width;
    for (const width of [390, 412]) {
      await page.setViewportSize({ width, height: 844 });
      const w = await previewWidth();
      assert.ok(w >= 100, `the ${width}px phone summary preview keeps its width (${w}px)`);
    }
    await page.setViewportSize({ width: 390, height: 844 });

    // 9b. A comparison on a phone: inline rows, round 1's question under its round-1 line 4.
    await page.goto(q({ review: range, compare: '1..2', file: 'a.js' }));
    const phoneQuestion = page.locator('[role=rowgroup] article', { hasText: 'Why change both lines?' });
    await phoneQuestion.waitFor();
    assert.equal(await isSplit(), false, 'a phone comparison shows inline rows');
    assert.equal((await rowBefore(phoneQuestion)).text, '4 · in question thread L3–L4 (old)||−|changed4');
    await shot('9b-phone-compare');

    // 10. The side pane has a handle; widening it pushes split down to inline, narrowing brings it back. At 1100px the
    // default pane leaves split room and the widest one does not (at 1440px even the widest pane leaves split room).
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.goto(q({ review: range, file: 'a.js' }));
    const handle = page.getByRole('separator', { name: 'Resize side pane' });
    await handle.waitFor();
    await viewGroup.waitFor();
    assert.ok(await isSplit(), 'the default pane leaves room for split at 1100px');
    const paneWidth = () => handle.evaluate((h) => h.parentElement.getBoundingClientRect().width);
    const before = await paneWidth();
    const drag = async (dx) => {
      const b = await handle.boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2, { steps: 8 });
      await page.mouse.up();
    };
    await drag(200);
    assert.equal(await paneWidth(), before + 200, 'dragging right widens the pane');
    await viewGroup.waitFor({ state: 'detached' });
    assert.equal(await isSplit(), false, 'the narrower diff pane falls back to inline');
    await shot('10-wide-pane-inline');
    // With room, the resolved summary stays on one line: preview and range share a row.
    const wideSummary = page.getByRole('button', { name: /Missing guard.*resolved/ });
    const [preview, rangeTag] = [await wideSummary.getByText('## Missing guard', { exact: true }).boundingBox(), await wideSummary.getByText('L8 (old)').boundingBox()];
    assert.equal(rangeTag.y + rangeTag.height / 2, preview.y + preview.height / 2, 'the wide summary is one line');
    await drag(-200);
    await viewGroup.waitFor();
    assert.ok(await isSplit(), 'narrowing the pane brings split back');
    await handle.focus();
    await page.keyboard.press('Home');
    await shot('10-pane-min'); // the header, scope line and tabs (with the unread badge) at the narrowest pane
    await page.keyboard.press('End');
    const pane = await page.getByRole('main').evaluate((m) => m.getBoundingClientRect().width);
    assert.ok(pane >= 384, `the diff pane keeps its minimum (${pane}px)`);
    const widest = await paneWidth();
    await shot('10-pane-max');
    await page.reload();
    await handle.waitFor();
    assert.equal(await paneWidth(), widest, 'the pane width survives a reload');
    await handle.focus(); // put the stored width back to the default for the next steps
    for (let w = widest; w > before; w -= 16) await page.keyboard.press('ArrowLeft');
    assert.equal(await paneWidth(), before);

    // 11. 1024px: the same single pane and handle; no Threads button and no dialog.
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(q({ review: range, file: 'a.js' }));
    await page.getByRole('grid').waitFor();
    assert.equal(await page.getByRole('separator', { name: 'Resize side pane' }).count(), 1, 'one side pane handle');
    assert.equal(await page.getByRole('button', { name: /^Threads/ }).count(), 0, 'no Threads button beside the diff');
    await page.getByRole('tablist', { name: 'Review pane' }).getByRole('tab', { name: /^Threads/ }).click();
    await page.getByRole('tablist', { name: 'Thread filter' }).waitFor();
    assert.equal(await page.getByRole('dialog').count(), 0, 'no dialog');
    await shot('11-md-pane-threads');
    assert.deepEqual(errors, []);
  }, { headless: true, viewport: { width: 1100, height: 800 } }); // the default 384px side pane leaves a split-wide diff (716px)
  // 12: an outdated thread's link opens its comparison; Focus on a thread of another file opens that file. The pane stays
  // on its Threads tab throughout.
  await withPage(async (page) => {
    const errors = watchErrors(page);
    const shot = shotter(page);
    const threadsTab = page.getByRole('tablist', { name: 'Review pane' }).getByRole('tab', { name: /^Threads/ });
    await page.goto(q({ review: range, file: 'a.js' }));
    await threadsTab.click();
    await page.getByRole('tab', { name: /^Outdated/ }).click();
    await shot('12a-outdated-link');
    await page.getByRole('button', { name: 'a.js · L3–L4 (new)' }).click(); // the outdated question's last located range
    await page.getByText('Exit comparison').waitFor();
    assert.match(page.url(), /compare=1\.\.2/, 'the outdated thread opens its round and the next');
    assert.equal(await threadsTab.getAttribute('aria-selected'), 'true', 'the comparison keeps the Threads tab');
    await page.locator('article[aria-label$="thread"]').first().waitFor();
    await shot('12b-outdated-comparison');
    await page.getByRole('button', { name: 'Exit comparison' }).click();
    await page.goto(q({ review: range, file: 'c.js' }));
    await threadsTab.click();
    await page.getByRole('tab', { name: /^All/ }).click();
    const card = page.getByRole('article').filter({ has: page.getByRole('button', { name: /^a\.js · L/ }) }).first();
    await card.getByRole('button', { name: 'Focus' }).click();
    await page.getByRole('grid', { name: 'Changes in a.js' }).waitFor();
    assert.match(page.url(), /file=a\.js/);
    assert.equal(new URL(page.url()).searchParams.get('view'), 'threads', 'the jump keeps view=threads');
    assert.equal(await threadsTab.getAttribute('aria-selected'), 'true', 'the jump keeps the Threads tab');
    await shot('12c-cross-file-focus');

    // 13. The scope line opens History and focuses its tab.
    await page.getByRole('button', { name: /^Round 2 · .* — show history$/ }).click();
    const historyTab = page.getByRole('tablist', { name: 'Review pane' }).getByRole('tab', { name: 'History' });
    await page.getByRole('navigation', { name: 'History' }).waitFor();
    assert.equal(await historyTab.getAttribute('aria-selected'), 'true');
    assert.ok(await historyTab.evaluate((t) => t === document.activeElement), 'the History tab has focus');
    await page.getByRole('navigation', { name: 'History' }).getByRole('link', { name: /^[0-9a-f]{7} / }).first().waitFor(); // the current round's commits
    await shot('13-history');
    assert.deepEqual(errors, []);
  }, { headless: true, viewport: { width: 1400, height: 900 } });

  // 14. Phone: the review opens on the pane's tabs; a thread's Focus opens the diff; Back returns to the Threads tab;
  // the diff's Threads button opens it too.
  await withPage(async (page) => {
    const errors = watchErrors(page);
    const shot = shotter(page);
    const tabs = page.getByRole('tablist', { name: 'Review pane' });
    await page.goto(q({ review: range }));
    await tabs.waitFor();
    assert.equal(await page.getByRole('grid').count(), 0, 'no diff without a file');
    await shot('14-phone-pane');
    await tabs.getByRole('tab', { name: /^Threads/ }).click();
    await page.getByRole('tab', { name: /^All/ }).click();
    const card = page.getByRole('article').filter({ has: page.getByRole('button', { name: /^a\.js · L/ }) }).first();
    await card.getByRole('button', { name: 'Focus' }).click();
    await page.getByRole('grid', { name: 'Changes in a.js' }).waitFor();
    assert.equal(await tabs.count(), 0, 'the diff replaces the pane');
    await shot('14-phone-diff');
    await page.getByRole('button', { name: 'Back to files' }).click();
    await tabs.waitFor();
    assert.equal(await tabs.getByRole('tab', { name: /^Threads/ }).getAttribute('aria-selected'), 'true', 'Back returns to the Threads tab');
    await tabs.getByRole('tab', { name: 'Files' }).click();
    await page.getByRole('link', { name: /a\.js/ }).first().click();
    await page.getByRole('grid').waitFor();
    await page.getByRole('button', { name: /^Threads/ }).click();
    await tabs.waitFor();
    assert.equal(await tabs.getByRole('tab', { name: /^Threads/ }).getAttribute('aria-selected'), 'true', 'the diff\'s Threads button opens the Threads tab');
    assert.equal(await page.getByRole('dialog').count(), 0, 'no dialog');
    await shot('14-phone-threads');
    assert.deepEqual(errors, []);
  }, { headless: true, viewport: { width: 390, height: 844 } });

  // 15: thread range rails, in light and dark. a.js (round 2) carries a suggestion on new L5–L7 and a question on new
  // L7–L9 (touching: two lanes), the resolved comment on L9, step 1's question on L10–L11 and the old-side L8 finding.
  await withPage(async (page) => {
    const errors = watchErrors(page);
    const SUGGESTION = 'suggestion thread L5–L7 (new)';
    const QUESTION = 'question thread L7–L9 (new)';
    const label = (c) => page.locator(`[data-cell="${c}"]`).getAttribute('aria-label');
    // A gutter's name is `<side> line <n> · in <range>, <range>…`.
    const inRange = async (range, cells) => Promise.all(cells.map(async (c) => ((await label(c)).split(' · in ')[1] ?? '').split(', ').includes(range)));
    const viewGroup = page.getByRole('group', { name: 'Diff view' });
    /**
     * WCAG non-text contrast of each rail in `cell` against what it sits on: the cell's ancestors' backgrounds, composited
     * top-down onto a 1×1 canvas (the tints are translucent), compared with the opaque rail colour.
     */
    const railContrast = (sel) => page.locator(sel).evaluate((cell) => {
      const ctx = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
      const paint = (colors) => { ctx.clearRect(0, 0, 1, 1); for (const c of colors) { ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); } return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)]; };
      const lum = (rgb) => { const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const layers = [];
      for (let n = cell; n; n = n.parentElement) { const bg = getComputedStyle(n).backgroundColor; if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') layers.unshift(bg); }
      const under = paint(layers);
      return [...cell.querySelectorAll('[data-rails] > span')].map((r) => {
        const [a, b] = [lum(paint([...layers, getComputedStyle(r).backgroundColor])), lum(under)];
        return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
      });
    });

    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      const shot = (name) => shotter(page)(`${name}-${scheme}`);
      const contrasts = {};
      const measure = async (name, sel) => { contrasts[name] = await railContrast(sel); };

      // Inline: each range's new gutters carry it, nothing around them does, no old gutter does.
      await page.goto(q({ review: range, file: 'a.js' }));
      await page.evaluate(() => localStorage.setItem('code-review:diffView', 'inline'));
      await page.reload();
      await page.getByRole('button', { name: ACCEPTED_SUMMARY }).click();
      await page.locator('[data-cell="new:5"]').waitFor();
      assert.deepEqual(await inRange(SUGGESTION, ['new:4', 'new:5', 'new:6', 'new:7', 'new:8']), [false, true, true, true, false]);
      assert.deepEqual(await inRange(QUESTION, ['new:6', 'new:7', 'new:8', 'new:9', 'new:10']), [false, true, true, true, false]);
      assert.deepEqual(await inRange(SUGGESTION, ['old:5', 'old:6', 'old:7']), [false, false, false], 'a new-side range marks no old gutter');
      assert.deepEqual(await inRange('finding thread L8 (old)', ['old:8']), [true], 'the old-side finding marks old 8');
      const lanes = await page.locator('[data-cell="new:7"] [data-rails] > span').evaluateAll((rs) => rs.map((r) => getComputedStyle(r).left));
      assert.deepEqual(lanes, ['0px', '4px'], 'touching ranges sit in separate lanes on their shared line');
      assert.equal(await page.locator('[data-line-target]').count(), 0, 'no thread paints a row target');
      await measure('add (new 6)', '[data-cell="new:6"]');
      await measure('ctx (new 9)', '[data-cell="new:9"]');
      await measure('del (old 8)', '[data-cell="old:8"]');
      await page.locator('[data-cell="new:6"]').scrollIntoViewIfNeeded();
      await shot('15-ranges-inline');

      // A selection over a rail (info tint): click a marked gutter, measure, then cancel the composer.
      await page.locator('[data-cell="new:6"]').click();
      const form = page.getByRole('form', { name: 'Comment on L6 (new)' });
      await form.waitFor();
      await measure('selected (new 6)', '[data-cell="new:6"]');
      await shot('15-ranges-selection');
      await form.getByRole('button', { name: 'Cancel' }).click();

      // Split: the same rails in the right half; the wrapped line 6 rail spans its full row height.
      await viewGroup.getByRole('button', { name: 'Split' }).click();
      await page.locator('[role=row].grid').first().waitFor();
      assert.deepEqual(await inRange(SUGGESTION, ['new:5', 'new:6', 'new:7']), [true, true, true]);
      const [cellH, railH] = await page.locator('[data-cell="new:6"]').evaluate((c) => [c.getBoundingClientRect().height, c.querySelector('[data-rails] > span').getBoundingClientRect().height]);
      assert.ok(cellH > 30 && railH === cellH, `the wrapped row's rail spans its full height (${railH}px of ${cellH}px)`);
      await measure('split add (new 6)', '[data-cell="new:6"]');
      await page.locator('[data-cell="new:6"]').scrollIntoViewIfNeeded();
      await shot('15-ranges-split');

      // Focus the suggestion: its rails turn active, the question's do not; on a reload its accepted hunk opens by itself.
      await page.locator('[role=rowgroup] article', { hasText: 'Split the long line' }).getByRole('button', { name: 'Focus' }).click();
      await page.locator('[data-cell="new:5"] [data-rails][data-active]').waitFor({ state: 'attached' });
      assert.equal(await page.locator('[data-cell="new:8"] [data-rails][data-active]').count(), 0, 'the question is not active');
      await page.reload();
      await page.locator('[data-cell="new:5"] [data-rails][data-active]').waitFor({ state: 'attached' });
      assert.equal(await page.getByRole('button', { name: ACCEPTED_SUMMARY }).count(), 0, 'the focused thread keeps its accepted hunk open');
      await measure('active add (new 5)', '[data-cell="new:5"]');
      await measure('active ctx (new 7, two lanes)', '[data-cell="new:7"]');
      await page.locator('[data-cell="new:6"]').scrollIntoViewIfNeeded();
      await shot('15-ranges-active');

      // A citation target (warning wash) under the rails.
      await page.goto(q({ review: range, file: 'a.js', side: 'new', lines: '5-9' }));
      await page.locator('[data-line-target]').waitFor();
      await measure('target add (new 6)', '[data-cell="new:6"]');
      await measure('target ctx (new 9)', '[data-cell="new:9"]');
      await shot('15-ranges-target');

      // Compare 1 → 2 (read-only, split): round 2's copies mark the right half.
      await page.goto(q({ review: range, compare: '1..2', file: 'a.js' }));
      await page.locator('[role=rowgroup] article', { hasText: 'Split the long line' }).waitFor();
      const rightGutter = (n) => page.locator('[role=row].grid').filter({ has: page.locator('[role=gridcell]:nth-child(4)', { hasText: new RegExp(`^${n}\\b`) }) }).locator('[role=gridcell]:nth-child(4)').first();
      assert.equal(await rightGutter(6).textContent(), `6 · in ${SUGGESTION}`, 'round 2\'s copy marks the right half');
      await rightGutter(6).scrollIntoViewIfNeeded();
      await shot('15-ranges-compare');

      console.log(`rail contrast (${scheme}):`, JSON.stringify(contrasts));
      for (const [where, ratios] of Object.entries(contrasts)) {
        assert.ok(ratios.length && ratios.every((r) => r >= 3), `${scheme}: every rail on ${where} reaches 3:1 (${ratios})`);
      }
    }

    // Forced colours (Windows High Contrast), under both schemes: the rails take the system colours (CanvasText, and
    // Highlight for the focused thread) rather than Canvas or a theme colour, and the focused rail is also wider, with
    // lanes still apart.
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme, forcedColors: 'active' });
      await page.goto(q({ review: range, file: 'a.js' }));
      await page.getByRole('button', { name: ACCEPTED_SUMMARY }).click();
      await page.locator('[data-cell="new:7"] [data-rails]').waitFor({ state: 'attached' });
      await page.locator('[role=rowgroup] article', { hasText: 'Split the long line' }).getByRole('button', { name: 'Focus' }).click();
      await page.locator('[data-cell="new:7"] [data-rails][data-active]').waitFor({ state: 'attached' });
      // What the system colours resolve to in this palette, from a sentinel element.
      const system = await page.evaluate(() => Object.fromEntries(['CanvasText', 'Highlight'].map((c) => {
        const el = Object.assign(document.createElement('div'), { style: `forced-color-adjust: none; background-color: ${c}` });
        document.body.append(el);
        const v = getComputedStyle(el).backgroundColor;
        el.remove();
        return [c, v];
      })));
      const rails = await page.locator('[data-cell="new:7"] [data-rails] > span').evaluateAll((rs) => rs.map((r) => {
        const b = r.getBoundingClientRect();
        return { color: getComputedStyle(r).backgroundColor, left: b.left, right: b.right, width: b.width };
      }));
      const forced = await railContrast('[data-cell="new:7"]');
      console.log(`rail contrast (forced colors, ${scheme}):`, JSON.stringify(forced), JSON.stringify(rails), JSON.stringify(system));
      // new 7: the focused suggestion in lane 0, the question in lane 1.
      assert.equal(rails[0].color, system.Highlight, `forced ${scheme}: the focused rail is Highlight`);
      assert.equal(rails[1].color, system.CanvasText, `forced ${scheme}: other rails are CanvasText`);
      assert.ok(rails[0].width >= 2 * rails[1].width, `forced ${scheme}: the focused rail is at least twice as wide (${rails[0].width} vs ${rails[1].width})`);
      assert.ok(rails[0].right < rails[1].left, `forced ${scheme}: the wider rail leaves a gap before the next lane`);
      assert.ok(forced.length === 2 && forced.every((r) => r >= 3), `forced ${scheme}: both rails on new 7 reach 3:1 (${forced})`);
      await page.locator('[data-cell="new:6"]').scrollIntoViewIfNeeded();
      await shotter(page)(`15-ranges-forced-colors-${scheme}`);
    }
    assert.deepEqual(errors, []);
  }, { headless: true, viewport: { width: 1100, height: 800 }, deviceScaleFactor: 2 });
  console.log('golden path ok');
} finally {
  await world.close();
}
