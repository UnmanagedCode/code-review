// One deterministic world for the visual harness: a temp repo with a `feature` worktree, a fake cc, a temp store and
// a booted server, seeded through the REST/MCP API. Reuses the backend test helpers, so there is one implementation.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER } from './resolve.mjs';
import { lines } from '../../tests/_git.js';
import { editLines, world } from '../../tests/_world.js';

const { bootServer } = await import(BROWSER);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function seed() {
  const w = await world();
  let srv;
  try {
    const wt = w.addWorktree('feature');
    wt.commit({
      'a.js': editLines({ 3: 'changed3', 4: 'changed4', 8: 'changed8' }),
      'b.js': null,
      'c.js': `${lines(10, 'b')}extra line\n`,
      'logo.bin': Buffer.from([0, 1, 2, 3, 0, 255]),
    }, 'first');
    wt.commit({ 'a.js': editLines({ 3: 'changed3', 4: 'changed4', 8: 'changed8', 19: 'changed19' }) }, 'second');
    w.session('s-author', { worktree: 'feature' });
    w.session('s-rev', { worktree: null, title: null, firstPrompt: 'Review the feature branch' }); // untitled: the fake cc labels it by its prompt
    w.session('s-cond', { project: '.conduct' });
    // s-rev has spawned workers into project `other`; s-author owns none.
    w.cc.state.projects.push({ name: 'other', path: '/o' });
    w.cc.state.conductorProjects['s-rev'] = [{ project: 'other', lastSpawnAt: '2026-01-01T00:00:01.000Z', worktrees: ['x'] }];

    srv = await bootServer({ cwd: projectRoot, entry: 'server.js', silent: true, env: { CODE_REVIEW_STORE: w.store.dir, CONDUCTOR_URL: process.env.CONDUCTOR_URL } });
    const call = async (method, p, body) => {
      const res = await fetch(`${srv.url}/api/${p}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const json = await res.json();
      if (json.ok === false || json.error) throw new Error(`${method} ${p}: ${JSON.stringify(json)}`);
      return json;
    };
    const mcp = async (tool, args, caller) => {
      const { result } = await call('POST', 'mcp', { tool, arguments: args, caller: { project: 'app', ...caller } });
      if (result?.ok === false) throw new Error(`${tool}: ${JSON.stringify(result)}`);
      return result;
    };
    const rev = { sessionId: 's-rev' };
    const author = { sessionId: 's-author' };

    const { review } = await call('POST', 'reviews', { project: 'app', worktree: 'feature', kind: 'range', base: 'main', recipient: 's-author', title: 'Feature work' });
    const id = review.id;
    await call('POST', `reviews/${id}/threads`, { anchor: { file: 'a.js', side: 'new', startLine: 3, endLine: 4 }, kind: 'question', body: 'Why change both lines? See a.js#L3-L4.' });
    const comment = (await call('POST', `reviews/${id}/threads`, { anchor: { file: 'a.js', side: 'new', startLine: 9, endLine: 9 }, kind: 'comment', body: 'Fine, but add a test.' })).thread;
    // A markdown body: heading, emphasis, list, a citation in inline code, a fence with one long line, a link.
    const finding = [
      '## Missing guard', '', 'The old line 8 had a **guard** that is now gone.', '',
      '- it ran before `a.js#L3`', '- callers relied on it', '',
      '```', `if (!ready) return; // ${'a very long line that must scroll inside the card '.repeat(4)}`, '```', '',
      'See [the docs](https://example.com/guards).',
    ].join('\n');
    await mcp('annotate', { review: id, kind: 'finding', severity: 'major', body: finding, file: 'a.js', side: 'old', startLine: 8 }, rev);
    await mcp('reply', { review: id, thread: comment.id, body: 'Test added. Resolving.', resolve: true }, author);

    // A third commit rewrites the questioned lines; refreshing turns that thread outdated. Line 6 is long enough to wrap in split view.
    const long6 = `r6 ${'a long line that has to wrap in the split view '.repeat(5)}`;
    wt.commit({ 'a.js': editLines({ 1: 'r1', 2: 'r2', 3: 'rewritten3', 4: 'rewritten4', 5: 'r5', 6: long6, 7: 'r7', 8: 'changed8', 19: 'changed19' }) }, 'third');
    await call('POST', `reviews/${id}/refresh`);
    // Two current-round ranges that touch at line 7 (separate rail lanes); the first spans the wrapping line 6.
    await call('POST', `reviews/${id}/threads`, { anchor: { file: 'a.js', side: 'new', startLine: 5, endLine: 7 }, kind: 'suggestion', body: 'Split the long line into a list.' });
    await mcp('annotate', { review: id, kind: 'question', body: 'Does r7 still need changed8 after it?', file: 'a.js', side: 'new', startLine: 7, endLine: 9 }, rev);
    const diff = await call('GET', `reviews/${id}/diff?file=a.js`);
    const [h1, h2] = diff.files[0].hunks;
    await call('PUT', `reviews/${id}/hunks/${h1.id}/verdict`, { verdict: 'accepted' });
    await call('PUT', `reviews/${id}/hunks/${h2.id}/verdict`, { verdict: 'rejected' });
    wt.commit({ 'c.js': `${lines(10, 'b')}extra line\nanother\n` }, 'fourth'); // HEAD moves past the round: refresh available

    // A conductor-opened commit review: the conductor is the recipient and names the worker as author.
    const conducted = (await mcp('open_review', { project: 'app', worktree: 'feature', kind: 'commit', author: 's-author', title: 'Conductor review' }, { sessionId: 's-cond', project: '.conduct' })).review;

    // An uncommitted review with a reviewer finding.
    wt.write('a.js', editLines({ 2: 'uncommitted2' }));
    const un = (await call('POST', 'reviews', { project: 'app', worktree: 'feature', kind: 'uncommitted', recipient: 's-author' })).review;
    await mcp('annotate', { review: un.id, kind: 'finding', severity: 'minor', body: 'Name this better.', file: 'a.js', side: 'new', startLine: 2 }, rev);

    const deliver = async (rid) => {
      const { submission } = await call('POST', `reviews/${rid}/submissions`);
      await call('POST', `reviews/${rid}/submissions/${submission.id}/result`, { ok: true });
    };
    // The conductor's review was delivered, then the conductor answered: your turn again.
    const asked = (await call('POST', `reviews/${conducted.id}/threads`, { anchor: { file: 'c.js', side: 'new', startLine: 12, endLine: 12 }, kind: 'question', body: 'Is this line needed?' })).thread;
    await deliver(conducted.id);
    await mcp('reply', { review: conducted.id, thread: asked.id, body: 'Yes, the parser reads it.' }, { sessionId: 's-cond', project: '.conduct' });

    // A review of the main checkout, delivered with no answer yet: waiting on the agent.
    w.repo.write('b.js', `${lines(10, 'b')}main edit\n`);
    const main = (await call('POST', 'reviews', { project: 'app', kind: 'uncommitted', recipient: 's-rev', title: 'Main checkout tidy-up' })).review;
    await call('POST', `reviews/${main.id}/threads`, { anchor: { file: 'b.js', side: 'new', startLine: 11, endLine: 11 }, kind: 'comment', body: 'Keep this edit.' });
    await deliver(main.id);

    return {
      url: srv.url, ids: { range: id, uncommitted: un.id, conducted: conducted.id, main: main.id }, call,
      /**
       * Adds a throwaway worktree `spike` with a review titled "Spike experiment" (on demand, so earlier steps see only `feature`).
       * Resolves {id, destroy}; `destroy()` simulates cc deleting the worktree.
       */
      async spike() {
        const wt = w.addWorktree('spike');
        wt.commit({ 'd.js': 'spike\n' }, 'spike');
        const { review: r } = await call('POST', 'reviews', { project: 'app', worktree: 'spike', kind: 'range', base: 'main', title: 'Spike experiment' });
        return { id: r.id, destroy: () => wt.destroy() };
      },
      /** Makes the fake cc refuse every exec as SYSTEM_UNREACHABLE (true) or run them again (false). */
      systemDown(down) { w.cc.state.execHook = down ? () => ({ status: 502, body: { error: 'provider down', code: 'SYSTEM_UNREACHABLE' } }) : null; },
      async close() { await srv.close(); w.cleanup(); },
    };
  } catch (e) {
    await srv?.close();
    w.cleanup();
    throw e;
  }
}
