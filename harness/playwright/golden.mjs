// Golden-path interaction check: drives the real UI against a seeded world and saves a screenshot per step.
// Run: node harness/playwright/golden.mjs   (needs `npm install` first, for frontend/dist)
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER } from './resolve.mjs';
import { threadLink } from '../../src/links.js';
import { overviewStates, seed } from './seed.mjs';

const { withPage } = await import(BROWSER);

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(outDir, { recursive: true });
const HOST_URLS = /pluginBridge\.js|pluginTheme\.css/;

const world = await seed();
const { range, uncommitted, main, syntax, guided } = world.ids;
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

// A stub cc bridge, installed before the page's scripts: `window.__emit(session)` plays cc's active-session changes.
const STUB_BRIDGE = () => {
  const subs = new Set();
  const b = {
    session: undefined, sent: [], results: [],
    onSession(fn) { subs.add(fn); if (b.session !== undefined) fn(b.session); return () => subs.delete(fn); },
    async openSession() { return { ok: true }; },
    async sendPrompt(id, text) { b.sent.push([id, text]); return b.results.shift() ?? { ok: true }; },
  };
  window.ccBridge = b;
  window.__emit = (s) => { b.session = s; subs.forEach((f) => f(s)); };
};
const params = (page) => Object.fromEntries(new URL(page.url()).searchParams);

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
    // Each thread is one compact row (a button named "<state>: <place> — <preview>").
    const threadRows = allPanel.getByRole('button', { name: /: .+ — / });
    const rowCount = (n) => page.waitForFunction((want) => document.querySelectorAll('[role=tabpanel]:not([hidden]) button[aria-label*=" — "]').length === want, n);
    await threadRows.first().waitFor();
    const everyone = (await threadRows.allTextContents()).length;
    const agents = ['Missing guard', 'Does r7 still need changed8 after it?'];
    await allPanel.getByLabel('Owner').selectOption('agents');
    await rowCount(agents.length);
    const shownAgents = await threadRows.allTextContents();
    assert.equal(shownAgents.length, agents.length);
    for (const a of agents) assert.ok(shownAgents.some((t) => t.includes(a)), `agents list has ${a}`);
    await shot('1c-owner-agents');
    await allPanel.getByLabel('Owner').selectOption('user');
    await rowCount(everyone - agents.length);
    assert.ok((await threadRows.allTextContents()).every((t) => !agents.some((a) => t.includes(a))), 'user list has no agent thread');
    await shot('1c-owner-user');

    // 2. Accept a hunk; the tree tally follows.
    await page.goto(q({ review: range, file: 'c.js' }));
    const tree = page.getByRole('link', { name: /c\.js/ }).first();
    await tree.getByRole('img', { name: '0 accepted, 0 rejected, 1 undecided' }).waitFor();
    await page.getByRole('group', { name: 'Hunk verdict' }).first().getByRole('button', { name: 'Accept', exact: true }).click();
    await tree.getByRole('img', { name: '1 accepted, 0 rejected, 0 undecided' }).waitFor();
    await shot('2-accepted');

    // 2b. Accept file on a.js (seeded: one accepted, one rejected hunk). Clear the accepted one first so a hunk is pending;
    // Accept file then accepts it and leaves the rejected hunk rejected; the header and tree tallies follow.
    await page.goto(q({ review: range, file: 'a.js' }));
    const aTree = page.getByRole('link', { name: /a\.js/ }).first();
    const bars = page.getByRole('group', { name: 'Hunk verdict' });
    await aTree.getByRole('img', { name: '1 accepted, 1 rejected, 0 undecided' }).waitFor();
    await page.getByRole('button', { name: ACCEPTED_SUMMARY }).click();
    await bars.nth(0).getByRole('button', { name: 'Clear' }).click();
    await page.getByText('0/2 accepted · 1 rejected').waitFor();
    await aTree.getByRole('img', { name: '0 accepted, 1 rejected, 1 undecided' }).waitFor();
    await shot('2b-before-accept-file');
    await page.getByRole('button', { name: 'Accept file' }).click();
    await page.getByText('1/2 accepted · 1 rejected').waitFor();
    await aTree.getByRole('img', { name: '1 accepted, 1 rejected, 0 undecided' }).waitFor();
    // The accepted hunk collapses to its summary (no verdict bar); the rejected one stays expanded.
    await page.getByRole('button', { name: ACCEPTED_SUMMARY }).waitFor();
    assert.equal(await bars.count(), 1);
    assert.equal(await bars.nth(0).getByText('✗ Rejected').count(), 1, 'the remaining bar shows the rejected chip');
    assert.equal(await page.getByRole('button', { name: 'Accept file' }).isDisabled(), true);
    await shot('2b-accepted-file');

    // 3. Submit round without a bridge: the recap (undecided hunks warned, never blocking), Compose prompt, the copy dialog, Mark as sent, header says submitted.
    await page.getByRole('button', { name: 'Submit round' }).click();
    await page.getByRole('list', { name: 'What this round sends' }).waitFor();
    await page.getByText(/hunks? undecided/).waitFor();
    await shot('3-recap');
    await page.getByRole('button', { name: 'Compose prompt' }).click();
    const composed = page.getByLabel('Prompt');
    await composed.waitFor();
    const promptText = await composed.inputValue();
    assert.match(promptText, /Not reviewed yet/);
    assert.doesNotMatch(promptText, /Reviewer note/);
    await shot('3-copy-dialog');
    await page.getByRole('button', { name: 'Mark as sent' }).click();
    await page.getByText(/Round 2 · submitted/).waitFor();
    await shot('3-submitted');

    // 3a. The overall note, on the syntax review (so the range review's thread counts stay seed.mjs's): it is carried in the
    // prompt and kept as a review thread, listed in the Threads pane's Review tab.
    await page.goto(q({ worktree: 'syntax', review: syntax }));
    await page.getByRole('button', { name: 'Submit round' }).click();
    await page.getByRole('list', { name: 'What this round sends' }).waitFor();
    await page.getByLabel('Overall note').fill('Overall: the rename looks right.');
    await page.getByRole('button', { name: 'Compose prompt' }).click();
    const withNote = await page.getByLabel('Prompt').inputValue();
    assert.match(withNote, /Reviewer note \[t\d+\]/);
    assert.match(withNote, /Not reviewed yet/);
    await page.getByRole('button', { name: 'Mark as sent' }).click();
    await page.getByText(/Round 1 · submitted/).waitFor();
    await page.getByRole('tablist', { name: 'Review pane' }).getByRole('tab', { name: /^Threads/ }).click();
    await page.getByRole('tabpanel', { name: /^Threads/ }).getByRole('tab', { name: /^Review/ }).click();
    await page.getByText('Overall: the rename looks right.').first().waitFor();
    await page.goto(q({ review: range, file: 'a.js' }));

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
    await page.addInitScript(STUB_BRIDGE);
    await page.goto(`${world.url}/?project=app`);
    await page.getByText('Main checkout tidy-up').waitFor();
    await page.evaluate(() => window.__emit({ sessionId: 's-idle', project: 'app', worktree: null })); // baseline: matches the route, and has no review of its own
    await page.evaluate(() => window.__emit({ sessionId: 's-author', project: 'app', worktree: 'feature' })); // several reviews: the inbox's checkout, no single one to open
    await page.waitForFunction(() => location.search.includes('worktree=feature'));
    await page.getByText(/following/).waitFor();
    await shot('4-followed-session');

    // 4b: the active session's checkouts lead each select; New review prefills from it, and a typed title survives a session change.
    const groups = (id) => page.evaluate((i) => [...document.querySelectorAll(`#${i} optgroup`)].map((g) => [g.label, [...g.querySelectorAll('option')].map((o) => o.textContent)]), id);
    assert.deepEqual(await groups('cb-project'), [['Active session', ['app']], ['Other projects', ['other']]]);
    assert.deepEqual(await groups('cb-worktree'), [['Active session', ['feature']], ['Other worktrees', ['Main checkout', 'syntax', 'guided']]]);
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
    assert.deepEqual(await groups('cb-worktree'), [['Active session', ['Main checkout']], ['Other worktrees', ['feature', 'syntax', 'guided']]]);

    await page.goto(q({ review: uncommitted }));
    // The stub is re-installed on navigation (no session emitted); make the first send fail.
    await page.evaluate(() => { window.ccBridge.results.push({ ok: false, code: 'SESSION_NOT_READY' }); });
    await page.getByRole('button', { name: 'Request review' }).click();
    await page.getByRole('list', { name: 'What this round sends' }).waitFor();
    await page.getByRole('button', { name: /^Send to/ }).click();
    await page.getByText(/busy or switching models/).waitFor();
    await shot('4-not-ready');
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.getByText(/Round 1 · submitted/).waitFor();
    const sent = await page.evaluate(() => window.ccBridge.sent.map(([id]) => id));
    assert.deepEqual(sent, ['s-author', 's-author']);
    assert.equal(await page.getByText(/isn.t recorded as delivered/).count(), 0, 'no false undelivered banner after delivery');
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
    // A focused thread collapses when it gets resolved, too: reopen it, focus it, resolve it.
    await finding.getByRole('button', { name: 'Reopen' }).click();
    await finding.getByRole('button', { name: 'Focus' }).click();
    await page.waitForURL(/thread=/);
    await finding.getByRole('button', { name: 'Resolve as fixed' }).click();
    await findingSummary.waitFor();
    assert.equal(await findingSummary.getAttribute('aria-expanded'), 'false', 'a focused thread collapses once resolved');
    await shot('8-resolved-focused');

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
    await page.getByRole('button', { name: /^outdated: a\.js#L3–L4 — / }).click(); // the outdated question's last located range
    await page.getByText('Exit comparison').waitFor();
    assert.match(page.url(), /compare=1\.\.2/, 'the outdated thread opens its round and the next');
    assert.equal(await threadsTab.getAttribute('aria-selected'), 'true', 'the comparison keeps the Threads tab');
    await page.locator('article[aria-label$="thread"]').first().waitFor();
    await shot('12b-outdated-comparison');
    await page.getByRole('button', { name: 'Exit comparison' }).click();
    await page.goto(q({ review: range, file: 'c.js' }));
    await threadsTab.click();
    await page.getByRole('tab', { name: /^All/ }).click();
    await page.getByRole('button', { name: /: a\.js#L.* — / }).first().click(); // a thread's row opens it in its file
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

  // 13b. cc steers an open frame onto a thread link of another review: replaceState + popstate, no reload.
  await withPage(async (page) => {
    const errors = watchErrors(page);
    const shot = shotter(page);
    const { files } = await world.call('GET', `reviews/${uncommitted}/diff?file=a.js`);
    const { review } = await world.call('GET', `reviews/${uncommitted}`);
    const link = threadLink(review, files[0].threads[0]);
    await page.goto(q({ review: range, file: 'a.js' }));
    await page.getByRole('grid', { name: 'Changes in a.js' }).waitFor();
    await page.evaluate((p) => { history.replaceState(null, '', p); dispatchEvent(new PopStateEvent('popstate')); }, new URL(link).hash.slice('#plugin/code-review/'.length));
    const card = page.getByRole('article', { name: /thread$/ }).filter({ hasText: 'Name this better.' });
    await card.waitFor();
    assert.equal(await card.getByRole('button', { name: 'Focus' }).count(), 0, 'the linked thread is the focused one');
    assert.equal(new URL(page.url()).searchParams.get('review'), uncommitted);
    await shot('13-steer-to-thread-link');
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
    await page.getByRole('button', { name: /: a\.js#L.* — / }).first().click();
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
  // 16: syntax highlighting, word emphasis and the Diff options, on the syntax review's hl.ts (seed.mjs: a one-word
  // change, a comment with a line added inside it, a re-indent-only hunk, a mixed hunk, markup in a string).
  await withPage(async (page) => {
    const errors = watchErrors(page);
    const sq = () => q({ worktree: 'syntax', review: syntax, file: 'hl.ts' });
    const grid = page.getByRole('grid');
    const cell = (c) => page.locator(`[data-cell="${c}"]`);
    const rowOf = (c) => page.locator('[role=row]', { has: cell(c) });
    const viewGroup = page.getByRole('group', { name: 'Diff view' });
    const menu = async (item, role = 'menuitemradio') => {
      await page.getByRole('button', { name: /^Diff options/ }).click();
      await page.getByRole(role, { name: item, exact: true }).click();
    };
    /**
     * WCAG text contrast of each token span in the rows matched by `rowSel`: its colour over the span's and its
     * ancestors' backgrounds (translucent tints, composited top-down on a 1×1 canvas), lowest per class (and emphasis).
     * Every token must reach 4.5:1 on each row tint and 3:1 under word emphasis (index.css `--cr-token-*`).
     */
    const tokenContrast = (rowSel) => page.locator(rowSel).evaluateAll((rows) => {
      const ctx = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
      const paint = (colors) => { ctx.clearRect(0, 0, 1, 1); for (const c of colors) { ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); } return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)]; };
      const lum = (rgb) => { const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const out = {};
      for (const row of rows) {
        for (const span of row.querySelectorAll('[data-token], [data-emphasis]')) {
          const layers = [];
          for (let n = span; n; n = n.parentElement) { const bg = getComputedStyle(n).backgroundColor; if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') layers.unshift(bg); }
          const [a, b] = [lum(paint([...layers, getComputedStyle(span).color])), lum(paint(layers))];
          const ratio = Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
          const key = `${span.className || 'plain'}${span.hasAttribute('data-emphasis') ? ' +em' : ''}`;
          out[key] = Math.min(out[key] ?? Infinity, ratio);
        }
      }
      return out;
    });

    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      const shot = (name) => shotter(page)(`${name}-${scheme}`);
      await page.goto(sq());
      await page.evaluate(() => localStorage.setItem('code-review:diffView', 'inline'));
      await page.reload();
      await grid.locator('[data-token]').first().waitFor();
      assert.ok(await grid.locator('[data-emphasis]').count() >= 4, 'paired changed lines carry word emphasis');
      assert.equal(await grid.locator('img, script').count(), 0, 'markup in the file renders no element');
      assert.ok((await rowOf('new:81').textContent()).includes("'<img src=x onerror=alert(1)><script>alert(2)</script>'"), 'the markup line shows as its text');
      // The comment opened on context line 20 colours the added line 22 too.
      assert.equal(await rowOf('new:22').locator('[data-token]').first().getAttribute('class'), 'text-token-comment italic');
      const contrast = {
        add: await tokenContrast('[role=row].bg-success\\/10'),
        del: await tokenContrast('[role=row].bg-destructive\\/10'),
        ctx: await tokenContrast('[role=row]:not(.bg-success\\/10):not(.bg-destructive\\/10)'),
      };
      await shot('16-syntax-inline');
      // hl.py: its comment and docstring have their own classes; the changed return line carries emphasis and a trailing comment.
      await page.goto(q({ worktree: 'syntax', review: syntax, file: 'hl.py' }));
      await grid.locator('[data-token]').first().waitFor();
      assert.equal(await grid.locator('[data-token]').first().getAttribute('class'), 'text-token-comment italic', 'a Python # comment is a comment');
      assert.equal(await grid.locator('[data-token]', { hasText: '"""docstring"""' }).first().getAttribute('class'), 'text-token-string', 'a docstring is a string via its alias');
      contrast['py add'] = await tokenContrast('[role=row].bg-success\\/10');
      contrast['py del'] = await tokenContrast('[role=row].bg-destructive\\/10');
      contrast['py ctx'] = await tokenContrast('[role=row]:not(.bg-success\\/10):not(.bg-destructive\\/10)');
      await shot('16-syntax-python');
      await page.goto(sq());
      await grid.locator('[data-token]').first().waitFor();
      // A citation target (warning wash replaces the add/del tint): new 4-5 is a context row and the emphasised added line, old 5 the emphasised deleted line.
      await page.goto(q({ worktree: 'syntax', review: syntax, file: 'hl.ts', side: 'new', lines: '4-5' }));
      await page.locator('[data-line-target]').waitFor();
      contrast['target ctx+add'] = await tokenContrast('[role=row].bg-warning\\/20');
      await page.goto(q({ worktree: 'syntax', review: syntax, file: 'hl.ts', side: 'old', lines: '5' }));
      await page.locator('[data-line-target]').waitFor();
      contrast['target del'] = await tokenContrast('[role=row].bg-warning\\/20');
      await page.goto(sq());
      await grid.locator('[data-token]').first().waitFor();
      // A selection (info tint) over an emphasised changed line, deleted and added.
      for (const side of ['old', 'new']) {
        await cell(`${side}:5`).click();
        const form = page.getByRole('form', { name: `Comment on L5 (${side})` });
        await form.waitFor();
        contrast[`selected ${side === 'old' ? 'del' : 'add'}`] = await tokenContrast('[role=row][aria-selected=true]');
        await rowOf(`${side}:5`).scrollIntoViewIfNeeded();
        await shot(`16-syntax-selection-${side}`);
        await form.getByRole('button', { name: 'Cancel' }).click();
      }
      // Split: each half tinted on its own.
      await viewGroup.getByRole('button', { name: 'Split' }).click();
      await page.locator('[role=row].grid').first().waitFor();
      await grid.locator('[data-token]').first().waitFor();
      await shot('16-syntax-split');
      await viewGroup.getByRole('button', { name: 'Inline' }).click();
      console.log(`token contrast (${scheme}):`, JSON.stringify(contrast));
      for (const [tint, byClass] of Object.entries(contrast)) {
        for (const [cls, ratio] of Object.entries(byClass)) {
          const floor = cls.endsWith(' +em') ? 3 : 4.5;
          assert.ok(ratio >= floor, `${scheme}: ${cls} on ${tint} reaches ${floor}:1 (${ratio})`);
        }
      }
    }
    await page.emulateMedia({ colorScheme: 'light' });
    const shot = shotter(page);

    // Ignore whitespace: the re-indent-only hunk collapses to a "whitespace only" summary; the mixed hunk shows its
    // re-indented line as one row (old 61 / new 62) and keeps the real change. Then drag-select across the merged row.
    await page.goto(sq());
    await grid.locator('[data-token]').first().waitFor();
    await menu('Ignore whitespace', 'menuitemcheckbox');
    const wsOnly = page.getByRole('button', { name: /^@@ -38,9 \+39,9 @@.*whitespace only$/ });
    await wsOnly.waitFor();
    assert.equal(await cell('new:41').count(), 0, 'the whitespace-only hunk is collapsed');
    assert.equal(await rowOf('old:61').locator('[data-cell="new:62"]').count(), 1, 'the re-indented pair is one row');
    assert.equal(await rowOf('old:62').locator('[data-cell="new:63"]').count(), 0, 'the real change stays a change');
    assert.equal(await page.getByRole('button', { name: 'Diff options · ignoring whitespace' }).count(), 1);
    await shot('16-ignore-whitespace');
    await cell('new:62').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const [from, to] = [await cell('new:61').boundingBox(), await cell('new:63').boundingBox()];
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 6 });
    await page.mouse.up();
    await page.getByRole('form', { name: 'Comment on L61–L63 (new)' }).waitFor();
    await page.getByLabel('Message').fill('Why the extra + 1?');
    await page.getByRole('button', { name: 'Post' }).click();
    const posted = page.locator('[role=rowgroup] article', { hasText: 'Why the extra + 1?' });
    await posted.waitFor();
    assert.ok((await rowBefore(posted)).cells.includes('new:63'), 'the comment renders under line 63');
    await shot('16-ignore-whitespace-comment');
    // Expanded, the whitespace-only hunk shows its verdict bar.
    await wsOnly.click();
    await cell('new:41').waitFor();
    assert.equal(await page.getByRole('group', { name: 'Hunk verdict' }).count(), 5);
    await shot('16-ignore-whitespace-expanded');

    // Context 0: edge context goes into gaps (the first hunk is just its change); 10: the gaps open 7 lines each side.
    await menu('0');
    await page.waitForFunction(() => !document.querySelector('[data-cell="new:4"]'));
    assert.equal(await cell('new:5').count(), 1);
    assert.equal(await cell('new:3').count(), 0);
    await shot('16-context-0');
    await menu('10');
    await cell('new:15').waitFor();
    assert.equal(await cell('new:1').count(), 1, 'the leading gap (1 line) is fully open');
    await shot('16-context-10');
    await viewGroup.getByRole('button', { name: 'Split' }).click();
    await page.locator('[role=row].grid').first().waitFor();
    await cell('new:60').scrollIntoViewIfNeeded();
    await shot('16-options-split');
    await viewGroup.getByRole('button', { name: 'Inline' }).click();

    // Phone: the menu is reachable from the wrapped header.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(sq());
    await grid.locator('[data-token]').first().waitFor();
    await page.getByRole('button', { name: /^Diff options/ }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Ignore whitespace' }).waitFor();
    await shot('16-phone-options');
    await page.keyboard.press('Escape');
    assert.deepEqual(errors, []);
  }, { headless: true, viewport: { width: 1100, height: 800 } });
  // 18: a New review link (`view=new&range=…` / `&sha=…`) prefills the dialog; a bad link or a head other than HEAD says why
  // and leaves the defaults. Nothing is opened until the click.
  await withPage(async (page) => {
    const errors = watchErrors(page);
    const shot = shotter(page);
    const { commits } = await world.call('GET', 'checkout/commits?project=app&worktree=feature');
    const [head, , , first] = commits; // fourth, third, second, first
    const checked = (name) => page.getByRole('radio', { name }).getAttribute('aria-checked');
    const ready = () => page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent === 'Open review' && !b.disabled));
    const reviewsBefore = (await world.call('GET', 'reviews?project=app')).reviews.length;

    await page.goto(q({ view: 'new', range: 'main...HEAD' }));
    await ready();
    assert.equal(await checked(/main/), 'true', 'a fork-point base selects its radio');
    await shot('18-link-range-fork-point');

    await page.goto(q({ view: 'new', range: `${first.short}..${head.sha}` }));
    await ready();
    assert.equal(await checked('Another commit'), 'true');
    assert.equal(await page.getByLabel('Base commit').inputValue(), first.sha);
    await shot('18-link-range-sha-base');

    await page.goto(q({ view: 'new', sha: first.short }));
    await ready();
    assert.equal(await checked(/One commit/), 'true');
    assert.equal(await page.getByLabel('Commit', { exact: true }).inputValue(), first.sha);
    await shot('18-link-commit');

    await page.goto(q({ view: 'new', range: `main...${first.short}` }));
    await ready();
    assert.match(await page.getByRole('alert').textContent(), /could not be used.*HEAD/);
    assert.equal(await checked(/Range/), 'true');
    await shot('18-link-head-not-HEAD');

    // The fake cc answers 404 for an unknown ref: that one response is the link's expected refusal.
    await page.goto(q({ view: 'new', range: 'no-such-branch...HEAD' }));
    await ready();
    assert.match(await page.getByRole('alert').textContent(), /does not exist.*no-such-branch/);
    await shot('18-link-unknown-ref');
    assert.deepEqual(errors.filter((e) => !/^404 .*api\/checkout\/commit\?.*no-such-branch/.test(e)), []);
    assert.equal((await world.call('GET', 'reviews?project=app')).reviews.length, reviewsBefore, 'no link opened a review');

    await page.getByRole('button', { name: 'Cancel' }).click();
    assert.deepEqual(params(page), { project: 'app', worktree: 'feature' });
  }, { headless: true, viewport: { width: 1280, height: 900 } });

  // 18b: "Open in code-git", framed the way cc frames a plugin: a host page on the plugin's own origin holds the review in an
  // iframe whose /pluginBridge.js is a stub. A History commit row's link moves the host's hash to code-git's deep link,
  // without reloading the host.
  await withPage(async (page) => {
    const errors = watchErrors(page);
    const shot = shotter(page);
    const host = `${world.url}/cc-host.html?s=1`;
    const frameSrc = `/?${new URLSearchParams({ project: 'app', worktree: 'feature', review: range, view: 'history' })}`;
    await page.route(`${world.url}/cc-host.html*`, (r) => r.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><title>cc</title><style>body{margin:0}iframe{border:0;width:100vw;height:100vh}</style><iframe src="${frameSrc}"></iframe>`,
    }));
    await page.route(`${world.url}/pluginBridge.js`, (r) => r.fulfill({ contentType: 'text/javascript', body: `(${STUB_BRIDGE})();` }));
    await page.goto(host);
    await page.evaluate(() => { window.__notReloaded = true; });
    const frame = page.frameLocator('iframe');
    const { commits } = await world.call('GET', `reviews/${range}/commits`);
    const link = frame.getByRole('link', { name: `Open ${commits[0].short} in code-git` });
    await link.waitFor();
    assert.equal(await link.getAttribute('target'), '_top');
    await shot('18b-history-code-git-links');
    await link.click();
    await page.waitForFunction(() => location.hash.startsWith('#plugin/code-git/'));
    const hash = await page.evaluate(() => location.hash);
    assert.ok(hash.startsWith('#plugin/code-git/?project=app'), hash);
    assert.equal(new URLSearchParams(hash.split('#plugin/code-git/')[1]).get('commit'), commits[0].sha);
    assert.equal(await page.evaluate(() => `${location.pathname}${location.search}`), '/cc-host.html?s=1', 'only the hash moved');
    assert.equal(await page.evaluate(() => window.__notReloaded), true, 'the host did not reload');

    // The file header links to that file's history at the shown commit.
    await frame.getByRole('tab', { name: 'Files' }).click();
    await frame.getByRole('navigation', { name: 'Files' }).getByRole('link', { name: /a\.js/ }).click();
    const fileLink = frame.getByRole('link', { name: 'Open the history of a.js in code-git' });
    await fileLink.waitFor();
    const fileHash = new URLSearchParams((await fileLink.getAttribute('href')).split('#plugin/code-git/')[1]);
    assert.deepEqual(Object.fromEntries(fileHash), { project: 'app', worktree: 'feature', commit: (await world.call('GET', `reviews/${range}`)).review.headSha, path: 'a.js' });
    await shot('18b-file-header-code-git-link');
    await frame.getByRole('button', { name: 'Review actions' }).click();
    await frame.getByRole('menuitem', { name: 'Open head in code-git' }).waitFor();
    await shot('18b-actions-open-head');
    assert.deepEqual(errors, []);
  }, { headless: true, viewport: { width: 1400, height: 900 } });

  // 19: threads on a whole file and on the review. Comment on file in the header opens a composer in the file-threads block
  // above the diff; the posted finding sits there and resolves with a disposition into a summary. The Threads pane's Review
  // tab starts a review thread, listed there and in All; its Focus keeps the open file.
  await withPage(async (page) => {
    const errors = watchErrors(page);
    const shot = shotter(page);
    // From a diff scrolled to its end, the header's Comment on file brings the composer into view below the sticky header.
    await page.goto(q({ review: range, file: 'a.js' }));
    const aGrid = page.getByRole('grid', { name: /a\.js/ });
    await aGrid.waitFor();
    await page.locator('[role=row]').last().scrollIntoViewIfNeeded();
    assert.ok((await aGrid.boundingBox()).y < 0, 'the diff is scrolled past its top');
    await page.getByRole('button', { name: 'Comment on file' }).click();
    const aForm = page.getByRole('form', { name: 'Comment on This file' });
    await aForm.waitFor();
    await page.waitForTimeout(100); // the scroll runs after the composer mounts
    const header = await page.getByRole('button', { name: 'Comment on file' }).evaluate((b) => b.closest('.sticky').getBoundingClientRect().bottom);
    const box = await aForm.boundingBox();
    assert.ok(box.y >= header - 1 && box.y + box.height <= 800, `the file composer is in view below the header (top ${box.y}, header ${header})`);
    await shot('19-file-composer-scrolled');
    await aForm.getByRole('button', { name: 'Cancel' }).click();

    await page.goto(q({ review: range, file: 'c.js' }));
    await page.getByRole('grid', { name: /c\.js/ }).waitFor();
    await page.getByRole('button', { name: 'Comment on file' }).click();
    const block = page.getByRole('region', { name: 'File threads' });
    const form = block.getByRole('form', { name: 'Comment on This file' });
    await form.getByLabel('Kind').selectOption('finding');
    await form.getByLabel('Severity').selectOption('minor');
    await form.getByLabel('Message').fill('This file needs a header comment.');
    await shot('19-file-composer');
    await form.getByRole('button', { name: 'Post' }).click();
    const card = block.getByRole('article', { name: 'finding thread' });
    await card.getByText('Whole file').waitFor();
    assert.ok(await block.evaluate((b) => !!(b.compareDocumentPosition(document.querySelector('[role=grid]')) & Node.DOCUMENT_POSITION_FOLLOWING)), 'the block sits above the diff');
    assert.equal(await page.getByRole('grid').getByRole('article').count(), 0, 'no row holds the file thread');
    await shot('19-file-thread');
    await card.getByRole('button', { name: 'Resolve as fixed' }).click();
    const summary = block.getByRole('button', { name: /needs a header comment.*resolved.*fixed/ });
    await summary.waitFor();
    assert.equal(await summary.getAttribute('aria-expanded'), 'false', 'the resolved file finding collapses');
    await shot('19-file-finding-resolved');

    await page.getByRole('tablist', { name: 'Review pane' }).getByRole('tab', { name: /^Threads/ }).click();
    const panel = page.getByRole('tabpanel', { name: /^Threads/ });
    await panel.getByRole('tab', { name: /^Review/ }).click();
    await panel.getByRole('button', { name: 'New review thread' }).click();
    const rform = panel.getByRole('form', { name: 'Comment on This review' });
    await rform.getByLabel('Kind').selectOption('question');
    await rform.getByLabel('Message').fill('Is the split into c.js right?');
    await rform.getByRole('button', { name: 'Post' }).click();
    const rrow = panel.getByRole('button', { name: /: review — Is the split into c\.js right\?/ });
    await rrow.waitFor();
    await shot('19-review-thread');
    await panel.getByRole('tab', { name: /^All/ }).click();
    await rrow.waitFor();
    await panel.getByRole('tab', { name: /^Review/ }).click();
    await rrow.click(); // opening a review thread keeps the open file
    await page.waitForURL(/thread=/);
    assert.equal(params(page).file, 'c.js', 'Focus on a review thread keeps the open file');
    assert.equal(params(page).view, 'threads');
    assert.deepEqual(errors, []);
  }, { headless: true, viewport: { width: 1280, height: 800 } });

  // 21: guided review, on its own worktree. Steps, group verdicts, the carry-over a refresh makes, the hunk/group
  // contradiction note, "Open in file", links to group threads, Guide me, and the phone's step flow.
  await withPage(async (page) => {
    const errors = watchErrors(page);
    const shot = shotter(page);
    const gq = (o) => q({ worktree: 'guided', review: guided, ...o });
    const pane = page.getByRole('tablist', { name: 'Review pane' });
    const steps = page.getByRole('navigation', { name: 'Steps' }).getByRole('button');
    const step = (title) => page.getByRole('navigation', { name: 'Steps' }).getByRole('button', { name: new RegExp(title) });
    const groupBar = page.getByRole('group', { name: 'Group verdict' });
    // Scrolls the step's container until `path`'s file heading would sit under the sticky step header, and checks the heading
    // is pinned just below that header instead (visible, not covered).
    const scrollPastHeading = async (path, name) => {
      // A short viewport makes the step tall enough to scroll, whatever the screen.
      const size = page.viewportSize();
      await page.setViewportSize({ width: size.width, height: 480 });
      const heading = page.getByRole('region', { name: path }).getByRole('heading', { name: path });
      await heading.evaluate((h) => {
        const header = h.closest('[class*="flex-col"]').firstElementChild;
        let scroller = h.parentElement;
        while (scroller && !(scroller.scrollHeight > scroller.clientHeight && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
        scroller.scrollTop += h.getBoundingClientRect().top - header.getBoundingClientRect().bottom + 60;
      });
      // Wait for the pin to settle (heading top within 1px of the header's bottom); a real misalignment times out and fails the assertion below.
      await page.waitForFunction((p) => {
        const h = document.querySelector(`section[aria-label="${p}"] h3`);
        const header = document.querySelector('h2')?.closest('.sticky');
        return !!h && !!header && Math.abs(h.getBoundingClientRect().top - header.getBoundingClientRect().bottom) <= 1;
      }, path, { timeout: 3000 }).catch(() => {});
      const [h, header] = await Promise.all([heading.boundingBox(), page.getByRole('heading', { level: 2 }).first().evaluate((e) => e.closest('.sticky').getBoundingClientRect().bottom)]);
      assert.ok(Math.abs(h.y - header) <= 2, `${path}'s heading is pinned below the step header (heading ${h.y}, header bottom ${header})`);
      await shot(name);
      await page.evaluate(() => document.querySelector('main').scrollTo(0, 0));
      await page.setViewportSize(size);
    };
    // A step's first file bar starts open and the rest collapsed; this is the bar (a button inside the pinned heading) of `path`.
    const fileBar = (path) => page.getByRole('region', { name: path }).getByRole('button', { name: new RegExp(`^${path.replace('.', '\\.')}`) });
    const expandFile = async (path) => {
      const bar = fileBar(path);
      if ((await bar.getAttribute('aria-expanded')) !== 'true') await bar.click();
      await page.getByRole('region', { name: path }).getByRole('grid').first().waitFor();
    };

    // 1. The Guided tab lists the steps (three groups and Other changes); nothing is offered to ask for yet.
    await page.goto(gq({}));
    await pane.getByRole('tab', { name: 'Guided' }).click();
    await steps.first().waitFor();
    assert.equal(await steps.count(), 4);
    assert.match(await steps.nth(0).textContent(), /Rename the starting values/);
    assert.match(await steps.nth(3).textContent(), /Other changes/);
    assert.equal(await page.getByRole('button', { name: 'Guide me' }).count(), 0, 'nothing to ask for before a refresh');
    assert.ok(await step('Rename').getAttribute('aria-current') === 'step', 'the first step is current');
    await page.getByRole('heading', { name: 'Rename the starting values', level: 2 }).waitFor();
    await shot('21-1-steps');

    // 2. HEAD moved past G3's hunk: Refresh keeps two groups and drops G3, which lists as retired; Guide me is offered.
    await page.getByRole('button', { name: 'Refresh' }).click();
    const report = page.getByLabel('Refresh result');
    await report.waitFor();
    assert.match(await report.textContent(), /groups 2 kept, 1 dropped/);
    const retired = page.getByRole('region', { name: 'Retired groups' });
    await retired.getByText('One-line tweak in g3').waitFor();
    await page.getByRole('button', { name: 'Guide me' }).waitFor();
    await page.getByText('A refresh dropped 1 group since the last proposal').waitFor();
    assert.equal(await steps.count(), 3);
    await shot('21-2-refreshed');

    // 3. Step 1 spans two files; Accept group accepts it and its hunks, which collapse.
    await step('Rename').click();
    const g1 = page.getByRole('region', { name: 'g1.js' });
    const g2 = page.getByRole('region', { name: 'g2.js' });
    await fileBar('g1.js').waitFor();
    assert.equal(await fileBar('g1.js').getAttribute('aria-expanded'), 'true', 'the first file starts open');
    assert.equal(await fileBar('g2.js').getAttribute('aria-expanded'), 'false', 'the other files start collapsed');
    await g1.getByRole('grid').first().waitFor();
    assert.match(await fileBar('g2.js').textContent(), /\d+ hunks? · \d+ pending/, 'a collapsed bar says what is inside');
    await shot('21-3-step-first-open');
    await expandFile('g2.js');
    await shot('21-3-step-one');
    await scrollPastHeading('g1.js', '21-3-scrolled-heading');
    await page.getByRole('button', { name: 'Accept group' }).click();
    await page.getByRole('button', { name: ACCEPTED_SUMMARY }).first().waitFor();
    assert.equal(await page.getByRole('button', { name: ACCEPTED_SUMMARY }).count(), 2, 'both hunks are accepted and collapsed');
    await groupBar.getByText('✓ Accepted').waitFor();
    await page.waitForFunction(() => document.activeElement === document.querySelector('button[aria-label="Next step"]'));
    await step('Rename').getByText('accepted').waitFor();
    await shot('21-3-accepted');

    // 4. G2: hostile markup in its title and description stays inert. Reject group.
    await page.getByRole('button', { name: 'Next step' }).click();
    await page.getByRole('heading', { name: 'Tidy the tail <b>of g1</b>', level: 2 }).waitFor();
    await page.locator('.md').getByText('another').waitFor();
    assert.equal(await page.evaluate(() => window.__xss), undefined, 'no injected script ran');
    assert.equal(await page.locator('.md script, .md img, .md a[href^="javascript"]').count(), 0, 'no script, image or javascript: link in the description');
    assert.equal(await page.getByRole('heading', { level: 2 }).locator('b').count(), 0, 'the title is text');
    await page.emulateMedia({ colorScheme: 'dark' });
    await shot('21-4-dark-step');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.getByRole('button', { name: 'Reject group' }).click();
    await groupBar.getByText('✗ Rejected').waitFor();
    await shot('21-4-rejected');

    // 5. Comment on group: the thread appears in the step.
    await page.getByRole('button', { name: 'Comment on group' }).click();
    await page.getByLabel('Message').fill('Is the tail change needed?');
    await page.getByRole('button', { name: 'Post' }).click();
    await page.getByRole('region', { name: 'Group threads' }).getByRole('article').filter({ hasText: 'Is the tail change needed?' }).waitFor();
    await shot('21-5-group-thread');

    // 6. Other changes: per-hunk Accept; the step's badge counts decided hunks.
    await page.getByRole('button', { name: 'Next step' }).click();
    await page.getByRole('heading', { name: 'Other changes', level: 2 }).waitFor();
    assert.equal(await page.getByRole('group', { name: 'Group verdict' }).count(), 0, 'Other changes has no group verdict');
    const otherFile = page.getByRole('region').filter({ has: page.getByRole('button', { expanded: true }) }).first();
    await otherFile.getByRole('grid').first().waitFor();
    const pendingBefore = await otherFile.getByRole('button').first().textContent();
    assert.match(pendingBefore, /pending/, 'the bar counts what is still to decide');
    await page.getByRole('group', { name: 'Hunk verdict' }).first().getByRole('button', { name: 'Accept', exact: true }).click();
    await step('Other changes').getByText('1/2 decided').waitFor();
    assert.match(await otherFile.getByRole('button').first().textContent(), /1 hunk · decided/, 'the bar says decided once its hunk is accepted');
    await shot('21-6-other-changes');

    // 7. The retired G3 opens its own view.
    await retired.getByRole('button', { name: /One-line tweak in g3/ }).click();
    await page.getByRole('heading', { name: 'One-line tweak in g3', level: 2 }).waitFor();
    await page.getByText(/Retired in round \d+ \(refresh\)/).waitFor();
    await shot('21-7-retired');

    // 8. Changing one hunk of the accepted G1 sets the group back to pending, with a note saying why.
    await step('Rename').click();
    await page.getByRole('button', { name: ACCEPTED_SUMMARY }).first().click();
    await page.getByRole('group', { name: 'Hunk verdict' }).first().getByRole('button', { name: 'Clear', exact: true }).click();
    await groupBar.getByText('undecided').waitFor();
    await page.getByText('Set back to pending: you changed the verdict of one of its hunks.').waitFor();
    await shot('21-8-set-back-to-pending');

    // 9. Open in file: that file with the hunk's lines marked and in view; the Guided tab and step stay.
    await page.getByRole('link', { name: /^Open g1\.js at/ }).first().click();
    await page.waitForURL(/file=g1\.js/);
    assert.deepEqual({ view: params(page).view, step: params(page).step, side: params(page).side }, { view: undefined, step: 'g1', side: 'new' }); // the Guided tab is this visit's default: nothing was written, and the file keeps it
    const target = page.locator('[data-line-target]');
    await target.waitFor();
    const where = await target.boundingBox();
    assert.ok(where.y >= 0 && where.y + where.height <= 800, `the hunk's first line is in view (y ${where.y})`);
    assert.equal(await pane.getByRole('tab', { name: 'Guided' }).getAttribute('aria-selected'), 'true');
    await shot('21-9-open-in-file');
    // Back to the step: the file you came from is still open.
    await step('Rename').click();
    await page.getByRole('heading', { name: 'Rename the starting values', level: 2 }).waitFor();
    assert.equal(await fileBar('g1.js').getAttribute('aria-expanded'), 'true', 'the file stays open after Open in file and back');
    // An explicit view=guided (a saved tab choice) survives Open in file; then back to where this visit was.
    await page.goto(gq({ view: 'guided', step: 'g1' }));
    await page.getByRole('heading', { name: 'Rename the starting values', level: 2 }).waitFor();
    await expandFile('g1.js');
    await page.getByRole('link', { name: /^Open g1\.js at/ }).first().click();
    await page.waitForURL(/file=g1\.js/);
    assert.equal(params(page).view, 'guided', 'an explicit view=guided survives Open in file');
    await page.goto(gq({ step: 'g1' }));
    await page.getByRole('heading', { name: 'Rename the starting values', level: 2 }).waitFor();

    // 10. Reload keeps the step; Back returns to the previous one.
    await step('Rename').click();
    await page.getByRole('heading', { name: 'Rename the starting values', level: 2 }).waitFor();
    await page.reload();
    await page.getByRole('heading', { name: 'Rename the starting values', level: 2 }).waitFor();
    await page.getByRole('button', { name: 'Next step' }).click();
    await page.getByRole('heading', { name: 'Tidy the tail <b>of g1</b>', level: 2 }).waitFor();
    await page.goBack();
    await page.getByRole('heading', { name: 'Rename the starting values', level: 2 }).waitFor();
    assert.equal(params(page).step, 'g1');

    // 11. A group thread's link (what agent tools hand out) opens its step with the thread focused.
    const guide = (await world.call('GET', `reviews/${guided}`)).guide;
    const asked = guide.threads.find((t) => t.anchor.groupId === 'g1');
    const link = threadLink({ id: guided, project: 'app', worktree: 'guided' }, asked);
    await page.goto(`${world.url}/?${link.split('/?')[1]}`);
    await page.getByRole('region', { name: 'Group threads' }).getByRole('article').filter({ hasText: 'Why do these two files change together?' }).waitFor();
    assert.deepEqual({ view: params(page).view, step: params(page).step, thread: params(page).thread }, { view: 'guided', step: 'g1', thread: asked.id });
    assert.equal(await page.locator('article.ring-2:visible').count(), 1, 'the linked thread is focused'); // (the Threads pane holds a hidden copy)
    await shot('21-11-thread-link');

    // 12. Threads tab → All lists the group thread; its location link returns to the step.
    await pane.getByRole('tab', { name: /^Threads/ }).click();
    const panel = page.getByRole('tabpanel', { name: /^Threads/ });
    await panel.getByRole('tab', { name: /^All/ }).click();
    const card = panel.getByRole('article').filter({ hasText: 'Why do these two files change together?' });
    await card.waitFor();
    await shot('21-12-all-threads');
    await card.getByRole('button', { name: /^Step 1 · Rename the starting values/ }).click();
    await page.waitForURL(/view=guided/);
    assert.equal(params(page).step, 'g1');
    await page.getByRole('heading', { name: 'Rename the starting values', level: 2 }).waitFor();

    // 13. Guide me with no bridge: the prompt for the human to copy, then Mark as sent.
    await page.getByRole('button', { name: 'Guide me' }).click();
    const dialog = page.getByRole('dialog', { name: 'Guide me' });
    await dialog.getByRole('button', { name: 'Copy', exact: true }).waitFor();
    assert.ok((await dialog.getByLabel('Prompt').inputValue()).length > 0, 'the prompt is shown');
    await shot('21-13-guide-me');
    await dialog.getByRole('button', { name: 'Mark as sent' }).click();
    await dialog.waitFor({ state: 'detached' });

    // 14. Phone: the step list, then a step with Back to steps.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(gq({ view: 'guided' }));
    await steps.first().waitFor();
    await shot('21-14-phone-steps');
    await step('Rename').click();
    await fileBar('g2.js').waitFor();
    assert.equal(await fileBar('g1.js').getAttribute('aria-expanded'), 'true', 'the first file starts open on a phone too');
    await shot('21-14-phone-step-first-open');
    await expandFile('g2.js');
    await scrollPastHeading('g1.js', '21-14-phone-scrolled-heading');
    await page.getByRole('button', { name: 'Accept group' }).click();
    await groupBar.getByText('✓ Accepted').waitFor();
    await page.evaluate(() => document.querySelector('main').scrollTo(0, 0));
    await shot('21-14-phone-accepted-header');
    // The narrowest phone: Previous and Next never split, and the verdict control takes its own line, in every verdict state.
    await page.setViewportSize({ width: 360, height: 800 });
    const navRow = async (label) => {
      const [prev, next] = await Promise.all(['Previous step', 'Next step'].map((n) => page.getByRole('button', { name: n }).boundingBox()));
      assert.ok(Math.abs(prev.y - next.y) < 2, `${label}: Previous and Next share a row at 360`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${label}: no sideways scroll at 360`);
    };
    await navRow('accepted');
    await shot('21-14-360-accepted');
    // A carried group (accepted, pending hunks) adds a link beside the chip; the world cannot reach that state, so the link is injected for the layout check.
    await groupBar.evaluate((el) => { const b = el.querySelector('button').cloneNode(true); b.textContent = 'Accept group again'; el.querySelector('button').before(b); });
    await navRow('carried');
    await shot('21-14-360-carried');
    await groupBar.evaluate((el) => el.querySelector('button').remove());
    await groupBar.getByRole('button', { name: 'Clear' }).click();
    await groupBar.getByText('undecided').waitFor();
    await navRow('undecided');
    await scrollPastHeading('g1.js', '21-14-360-scrolled-heading');
    await shot('21-14-360-undecided');
    await groupBar.getByRole('button', { name: 'Accept group' }).click();
    await groupBar.getByText('✓ Accepted').waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Back to steps' }).click();
    await step('Tidy').click();
    await page.getByRole('heading', { name: 'Tidy the tail <b>of g1</b>', level: 2 }).waitFor();
    await page.getByRole('button', { name: 'Back to steps' }).waitFor();
    await shot('21-14-phone-step');
    await page.getByRole('button', { name: 'Back to steps' }).click();
    await steps.first().waitFor();
    assert.equal(params(page).step, undefined);
    assert.deepEqual(errors, []);
  }, { headless: true, viewport: { width: 1280, height: 800 } });

  // 20: cc's row ⋮ "Show reviews" (`?ccProject=&ccWorktree=`): a checkout with one open review opens it, one with several
  // lands on its list, an unknown name toasts and changes nothing, and cc's navigate (replaceState + popstate) retargets an
  // open page in place. Every landing replaces the cc params.
  await withPage(async (page) => {
    const errors = watchErrors(page);
    const shot = shotter(page);
    const cc = (p) => `${world.url}/?${new URLSearchParams(p)}`;
    const navigateCc = (p) => page.evaluate((search) => { history.replaceState(null, '', search); dispatchEvent(new PopStateEvent('popstate')); }, `?${new URLSearchParams(p)}`);
    const toast = (text) => page.locator('[data-sonner-toast]').filter({ hasText: text });

    // The syntax worktree has one open review: it opens.
    await page.goto(cc({ ccProject: 'app', ccWorktree: 'syntax' }));
    await page.getByRole('heading', { level: 1, name: 'Syntax' }).waitFor();
    await page.waitForFunction(() => !location.search.includes('cc'));
    assert.deepEqual(params(page), { project: 'app', worktree: 'syntax', review: syntax });
    await shot('20-menu-one-review');

    // The feature worktree has several: its Checkout tab, This checkout / Open.
    await page.goto(cc({ ccProject: 'app', ccWorktree: 'feature' }));
    await page.getByRole('region', { name: 'Reviews' }).getByText('Feature work').waitFor();
    assert.deepEqual(params(page), { project: 'app', worktree: 'feature' });
    assert.equal(await page.getByLabel('Scope').inputValue(), 'checkout');
    assert.equal(await page.getByLabel('Status').inputValue(), 'open');
    await shot('20-menu-list');

    // A project with no open review: the list says so.
    await page.goto(cc({ ccProject: 'other' }));
    await page.getByRole('region', { name: 'Reviews' }).getByText('No open reviews').waitFor();
    assert.deepEqual(params(page), { project: 'other' });
    await shot('20-menu-no-open-reviews');

    // An unknown project: a toast naming it, the params stripped, nothing chosen.
    await page.goto(cc({ ccProject: 'nope' }));
    await toast('code-conductor lists no project “nope”').waitFor();
    assert.deepEqual(params(page), {});
    await shot('20-menu-unknown-project');

    // With a review open, cc's navigate to an unknown worktree toasts and keeps the review; to the main checkout it
    // retargets in place (no reload) onto that checkout's one open review.
    await page.goto(q({ review: syntax }));
    await page.getByRole('heading', { level: 1, name: 'Syntax' }).waitFor();
    await page.evaluate(() => { window.__noReload = true; });
    const length = await page.evaluate(() => history.length);
    await navigateCc({ ccProject: 'app', ccWorktree: 'gone' });
    await toast('project “app” has no worktree “gone”').waitFor();
    assert.deepEqual(params(page), { project: 'app', worktree: 'feature', review: syntax });
    assert.ok(await page.getByRole('heading', { level: 1, name: 'Syntax' }).isVisible(), 'the open review stays');
    await shot('20-menu-retarget-refused');
    await navigateCc({ ccProject: 'app' });
    await page.getByRole('heading', { level: 1, name: 'Main checkout tidy-up' }).waitFor();
    assert.deepEqual(params(page), { project: 'app', review: main });
    assert.equal(await page.evaluate(() => window.__noReload), true, 'retargeted without a reload');
    assert.equal(await page.evaluate(() => history.length), length, 'no history entry added');
    await shot('20-menu-retarget');
    // The two unknown names answer 404 from the lookup, by design.
    assert.deepEqual(errors.filter((e) => !/^404 .*\/api\/checkout\/lookup\?/.test(e)), []);
  }, { headless: true, viewport: { width: 1280, height: 800 } });

  // 17: the inbox, with a stub cc bridge. From an open review, Inbox → the main checkout's row opens that review in its own
  // checkout; a session switch while it is open leaves it open; Back returns to the inbox. A destroyed worktree's row says
  // "checkout gone", and its Close closes the review. Runs last: it removes a worktree.
  await withPage(async (page) => {
    const errors = watchErrors(page);
    const shot = shotter(page);
    await page.addInitScript(STUB_BRIDGE);
    await page.goto(q({ review: range }));
    await page.getByRole('link', { name: /a\.js/ }).first().waitFor();
    await page.evaluate(() => window.__emit({ sessionId: 's-author', project: 'app', worktree: 'feature' }));
    await page.getByRole('link', { name: 'Inbox', exact: true }).click();
    const inbox = page.getByRole('region', { name: 'Inbox' });
    const row = (title) => inbox.getByRole('listitem').filter({ hasText: title });
    // The inbox is in triage sections: the delivered review waits on the agent, the one the conductor answered needs you.
    await inbox.getByRole('region', { name: /^Waiting on agent/ }).getByRole('listitem').filter({ hasText: 'Main checkout tidy-up' }).waitFor();
    await inbox.getByRole('region', { name: /^Needs you/ }).getByRole('listitem').filter({ hasText: 'Conductor review' }).waitFor();
    assert.equal(await inbox.getByText('Your turn').count(), 0, 'no row says Your turn');
    assert.deepEqual(params(page), { project: 'app', worktree: 'feature', view: 'inbox' });
    await shot('17-inbox');

    await row('Main checkout tidy-up').getByRole('link').click();
    const heading = page.getByRole('heading', { level: 1, name: 'Main checkout tidy-up' });
    await heading.waitFor();
    assert.deepEqual(params(page), { project: 'app', review: main });
    await page.evaluate(() => window.__emit({ sessionId: 's-rev', project: 'other', worktree: null }));
    await page.waitForTimeout(300); // nothing to wait for: following must not navigate
    assert.deepEqual(params(page), { project: 'app', review: main });
    assert.ok(await heading.isVisible(), 'the review stays open after a session switch');
    await shot('17-session-switch-ignored');
    await page.goBack();
    await row('Main checkout tidy-up').waitFor();
    assert.deepEqual(params(page), { project: 'app', worktree: 'feature', view: 'inbox' });

    const spike = await world.spike();
    spike.destroy();
    await page.reload();
    await row('Spike experiment').getByText('checkout gone').waitFor();
    assert.equal(await row('Feature work').getByText('checkout gone').count(), 0);
    await shot('17-inbox-checkout-gone');
    await row('Spike experiment').getByRole('button', { name: 'Close review Spike experiment' }).click();
    await row('Spike experiment').waitFor({ state: 'detached' });
    assert.equal((await world.call('GET', `reviews/${spike.id}`)).review.status, 'closed');
    await shot('17-inbox-closed');

    // 18. Switching to a file that is not cached keeps the previous file on screen, busy and inert, until the new diff arrives.
    await page.goto(q({ review: range, file: 'a.js' }));
    await page.getByRole('grid', { name: /a\.js/ }).waitFor();
    let release;
    const gate = new Promise((r) => { release = r; });
    await page.route(/\/diff\?.*file=c\.js/, async (route) => { await gate; await route.continue(); });
    await page.getByRole('link', { name: /c\.js/ }).first().click();
    const busy = page.locator('[aria-busy="true"]');
    await busy.waitFor();
    assert.equal(await busy.getAttribute('inert'), '', 'the switching diff is inert');
    assert.ok(await page.getByRole('grid', { name: /a\.js/ }).isVisible(), 'the previous file stays on screen while the next loads');
    assert.equal(await page.getByLabel('Loading diff').count(), 0, 'no skeleton replaces the previous file');
    await shot('18-switching');
    release();
    await page.getByRole('grid', { name: /c\.js/ }).waitFor();
    assert.equal(await page.locator('[aria-busy="true"]').count(), 0, 'the new file is not busy');
    await shot('18-switched');
    await page.unroute(/\/diff\?.*file=c\.js/);
    assert.deepEqual(errors, []);
  }, { headless: true, viewport: { width: 1280, height: 800 } });

  // 22. The overview and the progress strip: every number agrees across the strip, the overview and the filtered Threads list, a
  // row opens its thread in place, "Review next undecided hunk" opens the expected file, and "since you last looked" shows the
  // agent's news once, then nothing after a reload, then the next event as it arrives. A phone never scrolls sideways.
  const { ping } = await overviewStates(world);
  // The centre (`main`) is the scroller, so the page itself never reads wider: measure `main`, the pills and the overview's button in it.
  const noSideScroll = async (page, what) => {
    const { scroll, inner } = await page.evaluate(() => ({ scroll: document.scrollingElement.scrollWidth, inner: window.innerWidth }));
    assert.ok(scroll <= inner, `${what}: the page scrolls sideways (${scroll} > ${inner})`);
    const mains = await page.locator('main').evaluateAll((els) => els.map((m) => ({ over: m.scrollWidth - m.clientWidth, cut: [...m.querySelectorAll('button, a')].filter((b) => b.getBoundingClientRect().right > m.getBoundingClientRect().right + 0.5).map((b) => `${b.tagName} ${(b.getAttribute('aria-label') ?? b.textContent).slice(0, 60)}`) })));
    for (const m of mains) assert.deepEqual(m, { over: 0, cut: [] }, `${what}: main scrolls sideways or cuts a control off`);
    const clipped = await page.locator('a[aria-label$="need you"], a[aria-label$="will be sent"], a[aria-label$="waiting on agent"]')
      .evaluateAll((els, w) => els.filter((e) => e.getBoundingClientRect().right > w).length, inner);
    assert.equal(clipped, 0, `${what}: a pill is clipped`);
  };
  const pillCount = async (page, name) => Number((await page.getByRole('link', { name }).getAttribute('aria-label')).split(' ')[0]);
  const NEED = /threads? need you$/;
  const WILL = /threads? will be sent$/;

  // WCAG text contrast of an element's colour over its own and its ancestors' backgrounds (translucent tints composited top-down).
  const textContrast = (locator) => locator.first().evaluate((el) => {
    const ctx = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
    const paint = (colors) => { ctx.clearRect(0, 0, 1, 1); for (const c of colors) { ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); } return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)]; };
    const lum = (rgb) => { const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const layers = [];
    for (let n = el; n; n = n.parentElement) { const bg = getComputedStyle(n).backgroundColor; if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') layers.unshift(bg); }
    const [a, b] = [lum(paint([...layers, getComputedStyle(el).color])), lum(paint(layers))];
    return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
  });

  await withPage(async (page) => {
    const errors = watchErrors(page);
    const shot = shotter(page);
    const viewed = () => page.waitForResponse((r) => /\/viewed$/.test(r.url()) && r.request().method() === 'POST');
    const firstLoad = viewed();
    await page.goto(q({ review: range }));
    const needs = page.getByRole('region', { name: /^Needs you/ });
    await needs.waitFor();
    await firstLoad;
    const feed = page.getByRole('region', { name: /^What the agent did/ });
    assert.ok(await feed.getByRole('listitem').count() > 0, 'the first visit lists the agent news');
    assert.equal(await feed.getByText('Nothing new since you last looked').count(), 0);

    // The numbers agree: strip pill = overview card rows.
    const need = await pillCount(page, NEED);
    assert.equal(await needs.getByRole('listitem').count(), need, 'Needs you rows equal the "need you" pill');
    assert.ok(need > 0);
    const will = await pillCount(page, WILL);
    const yours = page.getByRole('region', { name: /^Your threads/ });
    assert.equal(await yours.getByRole('heading', { name: /^Will be sent/ }).locator('xpath=..').getByRole('listitem').count(), will, '"Will be sent" rows equal the pill');
    assert.ok(await yours.getByText('Sent with the next Submit round').isVisible());
    await shot('22-overview');

    // A row opens its thread in place; the card names whose move it is.
    const row = needs.getByRole('link').first();
    const chip = (await row.textContent()).includes('Agent says fixed') ? null : 'Needs your reply';
    await row.click();
    await page.getByRole('grid').waitFor();
    assert.ok(params(page).file && params(page).thread, 'the row opens its file and thread');
    const card = page.locator(`article[aria-label$="thread"]:visible`).filter({ has: page.getByText(chip ?? 'An agent proposes resolving this thread.') }).first();
    await card.waitFor();
    await shot('22-row-opens-thread');

    // The "will be sent" pill opens the Threads list filtered to those threads: chip count = pill = list length.
    await page.getByRole('link', { name: WILL }).click();
    await page.getByText(/^Showing: Will be sent/).waitFor();
    assert.equal(params(page).need, 'unsent');
    await page.getByText(new RegExp(`^Showing: Will be sent · ${will}$`)).waitFor();
    // Rows (and the routed thread's card, if it is one of them) in the shown Threads panel.
    const listed = page.locator('[role=tabpanel]:not([hidden]) :is(button[aria-label*=" — "], article[aria-label$="thread"])');
    await listed.first().waitFor();
    assert.equal(await listed.count(), will, 'the filtered list length equals the pill');
    await shot('22-filtered-threads');
    await page.getByRole('button', { name: 'Show all threads' }).click();
    assert.equal(params(page).need, undefined);

    // "Review next undecided hunk" opens the first file in tree order that has an undecided hunk.
    const files = (await world.call('GET', `reviews/${range}`)).files;
    assert.ok(files.every((f) => !f.path.includes('/')), 'the seeded files are at the root: name order is tree order');
    const expected = files.map((f) => f).sort((a, b) => a.path.localeCompare(b.path)).find((f) => f.verdicts.pending > 0).path;
    await page.goto(q({ review: range }));
    await page.getByRole('button', { name: /Review next undecided hunk/ }).click();
    await page.waitForURL((u) => new URL(u).searchParams.get('file') === expected);
    assert.equal(params(page).file, expected);
    await shot('22-next-undecided');

    // Reload: nothing is new. An agent reply then arrives live and joins the feed.
    const secondLoad = viewed().catch(() => null);
    await page.goto(q({ review: range }));
    await feed.getByText('Nothing new since you last looked').waitFor();
    await shot('22-nothing-new');
    await ping('Second look: all good.');
    await feed.getByText(/replied on/).first().waitFor();
    assert.equal(await feed.getByText('Nothing new since you last looked').count(), 0);
    await shot('22-new-event');
    void secondLoad;

    // The small state text reaches WCAG AA (4.5:1) in both themes: the strip's pills and link, and the state chips.
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(q({ review: range }));
      await needs.waitFor();
      const ratios = {
        'need you pill': await textContrast(page.getByRole('link', { name: NEED })),
        'will be sent pill': await textContrast(page.getByRole('link', { name: WILL })),
        'waiting on agent pill': await textContrast(page.getByRole('link', { name: /threads? waiting on agent$/ })),
        'k undecided link': await textContrast(page.getByRole('link', { name: /undecided →$/ })),
        'Needs your reply chip': await textContrast(needs.getByText('Needs your reply')),
        'Agent says fixed chip': await textContrast(needs.getByText('Agent says fixed — verify')),
      };
      await page.goto(q({ review: range, view: 'threads', need: 'unsent' }));
      const rows = page.getByRole('tabpanel').getByRole('button', { name: / — / });
      await rows.first().waitFor();
      ratios['Will be sent chip'] = await textContrast(rows.first().getByText('Will be sent', { exact: true }));
      await page.goto(q({ review: range, view: 'threads', need: 'waiting' }));
      await rows.first().waitFor();
      ratios['Waiting on agent chip'] = await textContrast(rows.first().getByText('Waiting on agent', { exact: true }));
      console.log(`state text contrast (${scheme}):`, JSON.stringify(ratios));
      for (const [what, ratio] of Object.entries(ratios)) assert.ok(ratio >= 4.5, `${scheme}: ${what} is ${ratio}:1, below 4.5:1`);
    }
    await page.emulateMedia({ colorScheme: 'light' });
    assert.deepEqual(errors, []);
  }, { headless: true, viewport: { width: 1280, height: 800 } });

  await withPage(async (page) => {
    const errors = watchErrors(page);
    const shot = shotter(page);
    // The pane with the strip, then the overview behind its link; a row opens its thread and Back returns to the overview.
    await page.goto(q({ review: range }));
    await page.getByRole('region', { name: 'Review progress' }).waitFor();
    await noSideScroll(page, 'the pane');
    await shot('22-phone-strip');
    await page.getByRole('link', { name: 'Overview', exact: true }).click();
    await page.getByRole('region', { name: /^Needs you/ }).waitFor();
    assert.equal(params(page).view, 'overview');
    await noSideScroll(page, 'the overview');
    await shot('22-phone-overview');
    await page.getByRole('region', { name: /^Needs you/ }).getByRole('link').first().click();
    await page.getByRole('grid').waitFor();
    await page.getByRole('button', { name: 'Back to files' }).click();
    await page.getByRole('region', { name: /^Needs you/ }).waitFor();
    assert.deepEqual(params(page), { project: 'app', worktree: 'feature', review: range, view: 'overview' });
    await page.getByRole('button', { name: 'Back to files' }).click();
    await page.getByRole('tablist', { name: 'Review pane' }).waitFor();
    // The "need you" pill shows the filtered list on the pane's Threads tab.
    await page.getByRole('link', { name: NEED }).click();
    await page.getByText(/^Showing: Needs you/).waitFor();
    await noSideScroll(page, 'the filtered Threads list');
    await shot('22-phone-filtered');

    // A long path (the first undecided file, since directories come first) must wrap inside the button, at every narrow width.
    const longPath = await world.longPath();
    for (const [width, scheme] of [390, 320, 768].flatMap((w) => ['light', 'dark'].map((c) => [w, c]))) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width, height: 844 });
      await page.goto(q({ review: range, view: 'overview' }));
      const next = page.getByRole('button', { name: /Review next undecided hunk/ });
      await next.waitFor();
      assert.ok((await next.textContent()).includes(longPath), 'the button names the long path');
      assert.equal(await next.getAttribute('title'), longPath, 'the full path is in the title');
      await noSideScroll(page, `the overview at ${width}px (${scheme}) with a long path`);
      await shot(`22-overview-long-path-${width}-${scheme}`);
    }
    assert.deepEqual(errors, []);
  }, { headless: true, viewport: { width: 390, height: 844 } });

  // 23. Landing, viewed marks, hunk bar chips, the tree filter and the phone's wrapped diff. Last, so earlier steps' worlds stay seed.mjs's.
  // 23a. Embedded in cc (a stub bridge): the session's single review opens; a session with none lands on the inbox of its checkout.
  for (const [vp, size] of [['desktop', { width: 1280, height: 800 }], ['phone', { width: 390, height: 844 }]]) {
    await withPage(async (page) => {
      const errors = watchErrors(page);
      const shot = shotter(page);
      await page.addInitScript(STUB_BRIDGE);
      const length = () => page.evaluate(() => history.length);
      // s-cond is the recipient of exactly one open review: the conductor's.
      await page.goto(world.url);
      const before = await length();
      await page.evaluate(() => window.__emit({ sessionId: 's-cond', project: 'app', worktree: null }));
      await page.getByRole('heading', { level: 1, name: 'Conductor review' }).waitFor();
      assert.equal(params(page).review, world.ids.conducted, 'the session\'s single review opens');
      assert.equal(await length(), before, 'the landing replaces the history entry');
      await shot(`23a-landing-review-${vp}`);
      // A session with no review of its own: the inbox, on its checkout.
      await page.goto(world.url);
      await page.evaluate(() => window.__emit({ sessionId: 's-none', project: 'app', worktree: 'feature' }));
      await page.getByRole('region', { name: 'Inbox' }).getByRole('listitem').first().waitFor();
      assert.deepEqual(params(page), { project: 'app', worktree: 'feature', view: 'inbox' });
      await shot(`23a-landing-inbox-${vp}`);
      assert.deepEqual(errors, []);
    }, { headless: true, viewport: size });
  }

  await withPage(async (page) => {
    const errors = watchErrors(page);
    const shot = shotter(page);
    const sq = (o) => q({ worktree: 'syntax', review: syntax, ...o });
    const viewedBtn = page.getByRole('button', { name: 'Viewed', exact: true });
    const pressed = async (loc) => (await loc.getAttribute('aria-pressed')) === 'true';
    const marked = (on) => page.waitForFunction((want) => document.querySelector('button[aria-label="Viewed"]')?.getAttribute('aria-pressed') === want, String(on));

    // 23b. Hunk bar: an undecided hunk offers Accept | Reject; Accept shows a chip with Clear; Clear is undecided again.
    await page.goto(sq({ file: 'hl.py' }));
    const bar = page.getByRole('group', { name: 'Hunk verdict' }).first();
    await bar.getByText('undecided').waitFor();
    assert.equal(await bar.getByRole('button', { name: 'Pending' }).count(), 0, 'no Pending segment');
    await shot('23b-hunk-undecided');
    // Reject keeps the hunk open: its chip, then Clear.
    await bar.getByRole('button', { name: 'Reject', exact: true }).click();
    await bar.getByText('✗ Rejected').waitFor();
    await shot('23b-hunk-rejected');
    await bar.getByRole('button', { name: 'Clear' }).click();
    await bar.getByText('undecided').waitFor();
    // Accept collapses the hunk to its summary; expanded again it shows the chip and Clear.
    await bar.getByRole('button', { name: 'Accept', exact: true }).click();
    await page.getByRole('button', { name: ACCEPTED_SUMMARY }).first().click();
    await bar.getByText('✓ Accepted').waitFor();
    await bar.getByRole('button', { name: 'Clear' }).click();
    await bar.getByText('undecided').waitFor();

    // 23c. Viewed: marking survives a reload; `v` toggles; a refresh that changes the file clears its mark, another file keeps it.
    await page.goto(sq({ file: 'hl.ts' }));
    await viewedBtn.click();
    await marked(true);
    await page.goto(sq({ file: 'hl.py' }));
    await viewedBtn.click();
    await marked(true);
    await page.reload();
    await viewedBtn.waitFor();
    assert.ok(await pressed(viewedBtn), 'the mark survives a reload');
    assert.ok(await page.getByRole('checkbox', { name: 'Viewed hl.py' }).isChecked(), 'the tree shows it');
    await page.keyboard.press('v');
    await marked(false);
    await page.keyboard.press('v');
    await marked(true);
    await shot('23c-viewed');
    world.commit('syntax', { 'hl.py': '# comment\ndef f(x):\n    """docstring"""\n    return repr(x)  # tail\n' }, 'change hl.py');
    await world.mcp('refresh_review', { review: syntax }, { sessionId: 's-author' });
    await page.reload();
    await viewedBtn.waitFor();
    assert.equal(await pressed(viewedBtn), false, 'a changed hunk clears the mark');
    assert.equal(await page.getByRole('checkbox', { name: 'Viewed hl.py' }).isChecked(), false);
    assert.ok(await page.getByRole('checkbox', { name: 'Viewed hl.ts' }).isChecked(), 'an unchanged file keeps its mark');
    await shot('23c-viewed-cleared');

    // 23d. Tree filter: `/` focuses the box (from the Threads tab too); text and the toggles narrow the list.
    await page.goto(q({ review: range }));
    await page.getByRole('searchbox', { name: 'Filter files' }).waitFor();
    const links = page.getByRole('navigation', { name: 'Files' }).getByRole('link');
    const total = await links.count();
    await page.getByRole('tablist', { name: 'Review pane' }).getByRole('tab', { name: /^Threads/ }).click();
    await page.keyboard.press('/');
    await page.waitForFunction(() => document.activeElement?.id === 'file-filter');
    assert.equal(params(page).view, 'files', '/ brings the Files tab forward');
    await page.keyboard.type('.js');
    await page.getByText(new RegExp(`^Showing \\d+ of ${total} files`)).waitFor();
    await page.getByRole('button', { name: /^Needs me/ }).click();
    await page.getByText(/^Showing \d+ of/).waitFor();
    const shown = await links.count();
    assert.ok(shown > 0 && shown < total, `text plus Needs me narrows the list (${shown} of ${total})`);
    await shot('23d-tree-filter');
    await page.getByRole('button', { name: 'Clear filter' }).click();
    assert.equal(await links.count(), total);
    assert.deepEqual(errors, []);
  }, { headless: true, viewport: { width: 1280, height: 800 } });

  // 23e. Phone: a long line wraps inside the grid (nothing clipped, no ellipsis) and the gutters are narrower than on a desktop.
  await withPage(async (page) => {
    const errors = watchErrors(page);
    const shot = shotter(page);
    await page.goto(q({ review: range, file: 'wide.js' }));
    const grid = page.getByRole('grid');
    await grid.waitFor();
    const fit = await grid.evaluate((g) => {
      const cells = [...g.querySelectorAll('[role=gridcell]')];
      return {
        grid: g.scrollWidth <= g.clientWidth,
        rowgroups: [...g.querySelectorAll('[role=rowgroup]')].every((r) => r.scrollWidth <= r.clientWidth),
        ellipsis: cells.filter((c) => getComputedStyle(c).textOverflow === 'ellipsis').length,
        gutter: Math.max(...[...g.querySelectorAll('[data-cell]')].map((c) => c.getBoundingClientRect().width)),
        longest: Math.max(...cells.map((c) => c.textContent.length)),
      };
    });
    assert.deepEqual({ grid: fit.grid, rowgroups: fit.rowgroups, ellipsis: fit.ellipsis }, { grid: true, rowgroups: true, ellipsis: 0 }, 'nothing clipped or ellipsized');
    assert.ok(fit.longest >= 200, 'the seeded line is long');
    assert.ok(fit.gutter < 48, `phone gutters are narrower than the desktop's (${fit.gutter}px)`);
    await shot('23e-phone-wrap');
    assert.deepEqual(errors, []);
  }, { headless: true, viewport: { width: 390, height: 844 } });

  // 24. Discoverability: the hover `+` on a commentable gutter line, and the default tab (Guided when the review has groups).
  await withPage(async (page) => {
    const errors = watchErrors(page);
    const shot = shotter(page);
    const cell = (n) => page.locator(`[data-cell="new:${n}"]`);
    const plus = (n) => cell(n).locator('[data-comment-plus]');
    const open = async () => {
      await page.goto(q({ review: range, file: 'a.js' }));
      const accepted = page.getByRole('button', { name: ACCEPTED_SUMMARY });
      if (await accepted.count()) await accepted.first().click();
      await cell(5).waitFor();
      await cell(5).scrollIntoViewIfNeeded();
    };
    const inside = (a, b) => a.x >= b.x - 0.5 && a.y >= b.y - 0.5 && a.x + a.width <= b.x + b.width + 0.5 && a.y + a.height <= b.y + b.height + 0.5;
    const bg = (loc) => loc.evaluate((el) => getComputedStyle(el).backgroundColor);

    // 24a. The `+` shows on hover, sits inside the cell, never intercepts the pointer, follows the pointer, and a drag under it still selects.
    await open();
    await page.mouse.move(2, 2);
    assert.equal(await plus(5).isVisible(), false, 'no + before hovering');
    await cell(5).hover();
    assert.equal(await plus(5).isVisible(), true, 'hovering a line number shows the +');
    const [chip, host] = [await plus(5).boundingBox(), await cell(5).boundingBox()];
    assert.ok(inside(chip, host), `the + sits inside its cell (${JSON.stringify(chip)} in ${JSON.stringify(host)})`);
    const centre = { x: chip.x + chip.width / 2, y: chip.y + chip.height / 2 };
    const hit = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return { onChip: !!el?.closest('[data-comment-plus]'), cell: el?.closest('[data-cell]')?.getAttribute('data-cell') ?? null };
    }, centre);
    assert.deepEqual(hit, { onChip: false, cell: 'new:5' }, 'the pointer lands on the cell beneath, not on the chip');
    await cell(6).hover();
    assert.equal(await plus(5).isVisible(), false, 'the + leaves with the pointer');
    assert.equal(await plus(6).isVisible(), true, 'and follows it to the next line');
    await cell(5).hover();
    await shot('24a-plus-light');
    // The chip is the active rail's colour in each theme (rail contrast, step 15, is measured on that pair).
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await open();
      // The active rail's fill, from a sentinel carrying the rail's own classes.
      const rail = await page.evaluate(() => {
        const el = Object.assign(document.createElement('span'), { className: 'bg-accent-foreground dark:bg-primary' });
        document.body.append(el);
        const v = getComputedStyle(el).backgroundColor;
        el.remove();
        return v;
      });
      await cell(7).hover();
      assert.equal(await bg(plus(7)), rail, `${scheme}: the + fill is the active rail colour`);
      await shot(`24a-plus-${scheme}`);
    }
    await page.emulateMedia({ colorScheme: 'light' });
    // Forced colours: the chip keeps a system-colour fill (a Canvas fill would erase it).
    await page.emulateMedia({ forcedColors: 'active' });
    await open();
    await cell(5).hover();
    const forced = { chip: await bg(plus(5)), cell: await bg(cell(5)) };
    assert.equal(await plus(5).isVisible(), true, 'forced colours: the + is visible');
    assert.notEqual(forced.chip, forced.cell, `forced colours: the + differs from its cell (${JSON.stringify(forced)})`);
    await shot('24a-plus-forced-colors');
    await page.emulateMedia({ forcedColors: 'none' });
    // A drag from L5 to L7 under the chip still opens the composer for that range.
    await open();
    await cell(5).hover();
    const start = await plus(5).boundingBox();
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    const to = await cell(7).boundingBox();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 6 });
    await page.mouse.up();
    await page.getByRole('form', { name: 'Comment on L5–L7 (new)' }).waitFor();

    // 24b. Read-only: the commit-filter view offers no +.
    const { commits } = await world.call('GET', `reviews/${range}/commits`);
    await page.goto(q({ review: range, file: 'a.js', commit: commits[0].sha }));
    await page.getByRole('grid').waitFor();
    await page.locator('[data-cell], [role=gridcell]').first().hover();
    assert.equal(await page.locator('[data-comment-plus]').count(), 0, 'no + in the commit-filter view');
    assert.equal(await page.locator('[data-comment-hint]').count(), 0, 'no hint in the commit-filter view');
    assert.deepEqual(errors, []);
  }, { headless: true, viewport: { width: 1280, height: 800 } });

  // 24e. Gutter width follows the file's widest line number, fixed for the file: stock widths up to three digits, and on a
  // file of 11000+ lines the hover + never covers a digit (4 and 5 digits, old and new side, desktop and the wrapped phone layout).
  const bigId = await world.bigFile();
  const gutterWidthOf = (loc) => loc.evaluate((el) => Math.round(el.getBoundingClientRect().width * 10) / 10);
  /** The hover + chip's rect and the number's text range (its text node) do not intersect. */
  const clearsNumber = (cell) => cell.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents([...el.childNodes].find((c) => c.nodeType === Node.TEXT_NODE));
    const text = range.getBoundingClientRect();
    const c = el.querySelector('[data-comment-plus]').getBoundingClientRect();
    return c.right <= text.left + 0.01 || text.right <= c.left + 0.01;
  });
  const bigCheck = async (page, label, stock) => {
    await page.goto(q({ worktree: 'big', review: bigId, file: 'big.js' }));
    await page.getByRole('grid').waitFor();
    for (const n of [1005, 11005]) {
      for (const side of ['new', 'old']) {
        const cell = page.locator(`[data-cell="${side}:${n}"]`);
        await cell.scrollIntoViewIfNeeded();
        const before = await gutterWidthOf(cell);
        await cell.hover();
        const chip = cell.locator('[data-comment-plus]');
        assert.equal(await chip.isVisible(), true, `${label} ${side}:${n}: the + shows`);
        assert.equal(await gutterWidthOf(cell), before, `${label} ${side}:${n}: hovering does not move the gutter`);
        assert.ok(before > stock, `${label} ${side}:${n}: the gutter is wider than the stock ${stock}px (${before}px)`);
        assert.equal(await clearsNumber(cell), true, `${label} ${side}:${n}: the + does not intersect the number`);
      }
    }
    const widths = await page.evaluate(() => ({ grid: document.querySelector('[role=grid]').scrollWidth <= document.querySelector('[role=grid]').clientWidth, doc: document.documentElement.scrollWidth <= document.documentElement.clientWidth }));
    assert.deepEqual(widths, { grid: true, doc: true }, `${label}: no sideways overflow`);
  };
  const stockCheck = async (page, label, stock) => {
    for (const url of [q({ worktree: 'guided', review: guided, file: 'g2.js' }), q({ review: range, file: 'a.js' })]) {
      await page.goto(url);
      await page.getByRole('grid').waitFor();
      const accepted = page.getByRole('button', { name: ACCEPTED_SUMMARY });
      if (await accepted.count()) await accepted.first().click();
      const cell = page.locator('[data-cell^="new:"]').first();
      await cell.waitFor();
      assert.equal(await gutterWidthOf(cell), stock, `${label}: a file up to three digits keeps the stock ${stock}px gutter (${new URL(url).searchParams.get('file')})`);
    }
  };
  await withPage(async (page) => {
    const errors = watchErrors(page);
    await stockCheck(page, '1280', 48);
    await bigCheck(page, '1280', 48);
    await shotter(page)('24e-big-file-desktop');
    assert.deepEqual(errors, []);
  }, { headless: true, viewport: { width: 1280, height: 800 } });
  await withPage(async (page) => {
    const errors = watchErrors(page);
    await stockCheck(page, '390', 36);
    // The stock 3-digit case: a number just clears the compact chip.
    await page.goto(q({ worktree: 'big', review: bigId, file: 'mid.js' }));
    await page.getByRole('grid').waitFor();
    for (const side of ['new', 'old']) {
      const cell = page.locator(`[data-cell="${side}:105"]`);
      await cell.scrollIntoViewIfNeeded();
      assert.equal(await gutterWidthOf(cell), 36, `390 ${side}:105: a three-digit file keeps the stock gutter`);
      await cell.hover();
      assert.equal(await cell.locator('[data-comment-plus]').isVisible(), true, `390 ${side}:105: the + shows`);
      assert.equal(await clearsNumber(cell), true, `390 ${side}:105: the + does not intersect the number`);
    }
    await bigCheck(page, '390', 36);
    await shotter(page)('24e-big-file-phone');
    assert.deepEqual(errors, []);
  }, { headless: true, viewport: { width: 390, height: 844 } });

  await withPage(async (page) => {
    const errors = watchErrors(page);
    const shot = shotter(page);
    const gq = (o = {}) => q({ worktree: 'guided', review: guided, ...o });
    const guidedTab = () => page.getByRole('tablist', { name: 'Review pane' }).getByRole('tab', { name: 'Guided' });
    const filesTab = () => page.getByRole('tablist', { name: 'Review pane' }).getByRole('tab', { name: 'Files' });
    const step = page.getByRole('heading', { name: 'Rename the starting values', level: 2 });

    // 24c. A grouped review opens on Guided with the step in the centre, writes nothing, and keeps the Overview and Files reachable.
    await page.goto(gq());
    await step.waitFor();
    const lenAfterLoad = await page.evaluate(() => history.length);
    assert.equal(await guidedTab().getAttribute('aria-selected'), 'true', 'a grouped review opens on Guided');
    assert.equal(params(page).view, undefined, 'the default is not written to the URL');
    assert.equal(await page.evaluate(() => history.length), lenAfterLoad, 'and adds no history entry');
    await shot('24c-guided-default');
    await filesTab().click();
    assert.equal(params(page).view, 'files', 'a Files click is saved in the URL');
    await page.reload();
    await filesTab().waitFor();
    assert.equal(await filesTab().getAttribute('aria-selected'), 'true', 'Files survives a reload');
    await page.goto(gq());
    await step.waitFor();
    await page.getByRole('link', { name: 'Overview' }).click();
    await page.getByRole('region', { name: /^Needs you/ }).waitFor();
    assert.equal(params(page).view, 'overview', 'the strip link reaches the Overview from the default tab');
    await page.goto(gq());
    await step.waitFor();
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.keyboard.press('o');
    await page.getByRole('region', { name: /^Needs you/ }).waitFor();
    assert.equal(params(page).view, 'overview', 'o reaches the Overview from the default Guided tab');
    await page.goto(gq({ file: 'g2.js' }));
    await page.getByRole('grid').waitFor();
    assert.equal(await filesTab().getAttribute('aria-selected'), 'true', 'a file deep link opens on Files');
    // The range review has no groups: Files, with the Overview in the centre.
    await page.goto(q({ review: range }));
    await page.getByRole('region', { name: /^Needs you/ }).waitFor();
    assert.equal(await filesTab().getAttribute('aria-selected'), 'true', 'a review without groups opens on Files');
    assert.deepEqual(errors, []);
  }, { headless: true, viewport: { width: 1280, height: 800 } });

  // 24d. Phone: a grouped review opens on the pane's Guided tab with the Steps list and no diff grid.
  await withPage(async (page) => {
    const errors = watchErrors(page);
    const shot = shotter(page);
    await page.goto(q({ worktree: 'guided', review: guided }));
    await page.getByRole('navigation', { name: 'Steps' }).waitFor();
    assert.equal(await page.getByRole('grid').count(), 0, 'no diff grid on the phone default');
    assert.equal(await page.getByRole('tablist', { name: 'Review pane' }).getByRole('tab', { name: 'Guided' }).getAttribute('aria-selected'), 'true');
    await shot('24d-phone-guided-default');
    assert.deepEqual(errors, []);
  }, { headless: true, viewport: { width: 390, height: 844 } });

  console.log('golden path ok');
} finally {
  await world.close();
}
