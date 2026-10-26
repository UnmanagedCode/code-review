// Request counts of a scripted session against the real UI and a seeded world, per step and per endpoint.
// Run: node harness/playwright/requests.mjs   (needs `npm run prepare` first, for frontend/dist)
// Compare builds by running it once per build of frontend/dist; NO_SHARED_WORKER=1 hides SharedWorker from the pages (one
// event stream per page then). Prints a table; asserts nothing.
import http from 'node:http';
import { BROWSER } from './resolve.mjs';
import { seed } from './seed.mjs';

const { withPage } = await import(BROWSER);
const world = await seed();

// Event-stream connections are counted at a proxy in front of the server: a SharedWorker's own requests are invisible to
// the page's request events. Everything else is forwarded untouched (streams included).
const target = new URL(world.url);
const proxy = http.createServer((req, res) => {
  if (new URL(req.url, 'http://x').pathname === '/api/events') bump('events');
  const up = http.request({ host: target.hostname, port: target.port, path: req.url, method: req.method, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  req.pipe(up);
  res.on('close', () => up.destroy());
});
await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${proxy.address().port}`;
const { range } = world.ids;
const search = (o) => `?${new URLSearchParams({ project: 'app', worktree: 'feature', ...o })}`;

/** The endpoint group of an /api request, or null for anything else. */
function group(url) {
  const u = new URL(url);
  const m = u.pathname.match(/^\/api\/(.*)$/);
  if (!m) return null;
  const p = m[1].split('/');
  if (p[0] === 'reviews' && p.length === 1) return 'reviews(list)';
  if (p[0] === 'reviews') return p[2] ? `review/${p[2]}` : 'review';
  if (p[0] === 'sessions' && p[2] === 'places') return 'places';
  return p.slice(0, 2).join('/').replace(/\/$/, '');
}

const table = [];
let current = null;
const begin = (name) => { current = { name, counts: {} }; table.push(current); };
const bump = (g) => { if (current) current.counts[g] = (current.counts[g] ?? 0) + 1; };

try {
  await withPage(async (page, { context }) => {
    if (process.env.NO_SHARED_WORKER) await context.addInitScript(() => { delete window.SharedWorker; });
    page.on('request', (r) => { const g = group(r.url()); if (g && g !== 'events') bump(g); });
    // cc steers an open frame with pushState/replaceState + popstate: navigate the SPA without a page load.
    const go = (o) => page.evaluate((s) => { history.pushState(null, '', s); window.dispatchEvent(new PopStateEvent('popstate')); }, search(o));
    const idle = () => page.waitForTimeout(700); // longer than the debounce; nothing to wait for
    const setVisibility = (v) => page.evaluate((state) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
      document.dispatchEvent(new Event('visibilitychange'));
    }, v);

    begin('1 open the list');
    await page.goto(`${base}/${search({})}`);
    await page.getByText('Feature work').waitFor();
    await idle();
    begin('2 open the review, file a.js');
    await go({ review: range, file: 'a.js' });
    await page.getByRole('grid', { name: /a\.js/ }).waitFor();
    await idle();
    begin('3 switch to file c.js');
    await go({ review: range, file: 'c.js' });
    await page.getByRole('grid', { name: /c\.js/ }).waitFor();
    await idle();
    begin('4 back to file a.js');
    await go({ review: range, file: 'a.js' });
    await page.getByRole('grid', { name: /a\.js/ }).waitFor();
    await idle();
    begin('5 back to the list');
    await go({});
    await page.getByText('Feature work').waitFor();
    await idle();
    begin('6 reopen the review, file a.js');
    await go({ review: range, file: 'a.js' });
    await page.getByRole('grid', { name: /a\.js/ }).waitFor();
    await idle();
    begin('7 another file changes (verdict in c.js, from outside)');
    const c = (await world.call('GET', `reviews/${range}/diff?file=c.js`)).files[0];
    await world.call('PUT', `reviews/${range}/hunks/${c.hunks[0].id}/verdict`, { verdict: 'accepted' });
    await idle();
    begin('7b back to the list');
    await go({});
    await idle();
    begin('8a hidden page, event for the review');
    await setVisibility('hidden');
    await world.call('PUT', `reviews/${range}/hunks/${c.hunks[0].id}/verdict`, { verdict: 'rejected' });
    await idle();
    begin('8b page visible again');
    await setVisibility('visible');
    await idle();

    // Two pages in one context share the browser's connection pool: count the event streams.
    begin('9 second page opened on the same origin');
    const second = await context.newPage();
    await second.goto(`${base}/${search({ review: range, file: 'a.js' })}`);
    await second.getByRole('grid', { name: /a\.js/ }).waitFor();
    await idle();
  }, { headless: true, viewport: { width: 1280, height: 800 } });
} finally {
  proxy.close();
  proxy.closeAllConnections();
  await world.close();
}

const cols = [...new Set(table.flatMap((s) => Object.keys(s.counts)))].sort();
console.log(['step'.padEnd(52), ...cols].join(' | '));
for (const s of table) console.log([s.name.padEnd(52), ...cols.map((c) => String(s.counts[c] ?? 0).padStart(c.length))].join(' | '));
console.log(['TOTAL'.padEnd(52), ...cols.map((c) => String(table.reduce((n, s) => n + (s.counts[c] ?? 0), 0)).padStart(c.length))].join(' | '));
