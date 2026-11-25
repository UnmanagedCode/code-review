// One deterministic world for the visual harness: a temp repo with a `feature` worktree, a fake cc, a temp store and
// a booted server, seeded through the REST/MCP API. Reuses the backend test helpers, so there is one implementation.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER } from './resolve.mjs';
import { lines } from '../../tests/_git.js';
import { editLines, world } from '../../tests/_world.js';

const { bootServer } = await import(BROWSER);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// hl.py, a comment line, a docstring and a trailing comment on a return line the head changes (a paired del/add).
const PY_BASE = '# comment\ndef f(x):\n    """docstring"""\n    return len(x)  # tail\n';
const PY_HEAD = PY_BASE.replace('len(x)', 'str(x)');

// hl.ts, 100 lines of filler (`const fN = N;`) with five edited spots, each far enough apart to be its own hunk.
const filler = Array.from({ length: 100 }, (_, i) => `const f${i + 1} = ${i + 1};`);
const HL_BASE_LINES = [...filler];
const HL_HEAD_LINES = [...filler];
const put = (lines, at, block) => lines.splice(at - 1, block.length, ...block);
// 1. A one-word change (line 5).
put(HL_BASE_LINES, 5, ['const limit = 10; // the max']);
put(HL_HEAD_LINES, 5, ['const limit = 20; // the max']);
// 2. A re-indented block only (lines 40–44): a whitespace-only hunk.
put(HL_BASE_LINES, 40, ['function inner(n: number) {', 'if (n > 0) {', 'return n * 2;', '}', '}']);
put(HL_HEAD_LINES, 40, ['function inner(n: number) {', '  if (n > 0) {', '    return n * 2;', '  }', '}']);
// 3. A mixed hunk: a re-indent and a real change (lines 60–63).
put(HL_BASE_LINES, 60, ['export class Box {', 'value = 1;', 'get(): number { return this.value; }', '}']);
put(HL_HEAD_LINES, 60, ['export class Box {', '  value = 1;', '  get(): number { return this.value + 1; }', '}']);
// 4. Markup inside a string, which must render as text (line 80).
put(HL_BASE_LINES, 80, ["const html = '<b>bold</b>';"]);
put(HL_HEAD_LINES, 80, ["const html = '<img src=x onerror=alert(1)><script>alert(2)</script>';"]);
// 5. A block comment opened in context, with a line added inside it (line 22). Last: the added line shifts the head below it.
put(HL_BASE_LINES, 20, ['/* Notes on the fixture:', ' * first note', ' */', 'export function greet(who: string): string { return `hello ${who}`; }']);
put(HL_HEAD_LINES, 20, ['/* Notes on the fixture:', ' * first note', ' */', 'export function greet(who: string): string { return `hello ${who}`; }']);
HL_HEAD_LINES.splice(21, 0, ' * an added note, still inside the comment');
const HL_BASE = `${HL_BASE_LINES.join('\n')}\n`;
const HL_HEAD = `${HL_HEAD_LINES.join('\n')}\n`;

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
    // code-git is enabled in cc: "Open in code-git" links show wherever the page is framed (golden step 18).
    w.cc.state.plugins.push({ id: 'code-git', name: 'Code Git', enabled: true, hasFrontend: true });

    // PROJECTS_ROOT: '' because bootServer inherits process.env and the child runs main(), which would otherwise move the real legacy store.
    srv = await bootServer({ cwd: projectRoot, entry: 'server.js', silent: true, env: { CONDUCTOR_PLUGIN_DATA_DIR: w.store.dir, PROJECTS_ROOT: '', CONDUCTOR_URL: process.env.CONDUCTOR_URL } });
    const call = async (method, p, body) => {
      const res = await fetch(`${srv.url}/api/${p}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const json = await res.json();
      if (json.ok === false || json.error) throw new Error(`${method} ${p}: ${JSON.stringify(json)}`);
      return json;
    };
    const mcp = async (tool, args, caller) => {
      const out = await call('POST', 'mcp', { tool, arguments: args, caller: { project: 'app', ...caller }, format: 'json' });
      if (out.error) throw new Error(`${tool}: ${JSON.stringify(out)}`);
      return out.structured;
    };
    const rev = { sessionId: 's-rev' };
    const author = { sessionId: 's-author' };

    const { review } = await call('POST', 'reviews', { project: 'app', worktree: 'feature', kind: 'range', base: 'main', recipient: 's-author', title: 'Feature work' });
    const id = review.id;
    await call('POST', `reviews/${id}/threads`, { anchor: { kind: 'lines', file: 'a.js', side: 'new', startLine: 3, endLine: 4 }, kind: 'question', body: 'Why change both lines? See a.js#L3-L4.' });
    const comment = (await call('POST', `reviews/${id}/threads`, { anchor: { kind: 'lines', file: 'a.js', side: 'new', startLine: 9, endLine: 9 }, kind: 'comment', body: 'Fine, but add a test.' })).thread;
    // A markdown body: heading, emphasis, list, a citation in inline code, a fence with one long line, a link.
    const finding = [
      '## Missing guard', '', 'The old line 8 had a **guard** that is now gone.', '',
      '- it ran before `a.js#L3`', '- callers relied on it', '',
      '```', `if (!ready) return; // ${'a very long line that must scroll inside the card '.repeat(4)}`, '```', '',
      'See [the docs](https://example.com/guards).',
    ].join('\n');
    await mcp('annotate', { review: id, anchor: 'lines', kind: 'finding', severity: 'major', body: finding, file: 'a.js', side: 'old', startLine: 8 }, rev);
    await mcp('reply', { review: id, thread: comment.id, body: 'Test added. Resolving.', resolve: true }, author);

    // A third commit rewrites the questioned lines; refreshing turns that thread outdated. Line 6 is long enough to wrap in split view.
    const long6 = `r6 ${'a long line that has to wrap in the split view '.repeat(5)}`;
    // wide.js: one 240-character line with no break opportunity, for the phone's wrap check.
    const wide = `export const wide = '${'0123456789'.repeat(24)}';`;
    wt.commit({ 'a.js': editLines({ 1: 'r1', 2: 'r2', 3: 'rewritten3', 4: 'rewritten4', 5: 'r5', 6: long6, 7: 'r7', 8: 'changed8', 19: 'changed19' }), 'wide.js': `// a wide line follows\n${wide}\n// and a short one\n` }, 'third');
    await call('POST', `reviews/${id}/refresh`);
    // Two current-round ranges that touch at line 7 (separate rail lanes); the first spans the wrapping line 6.
    await call('POST', `reviews/${id}/threads`, { anchor: { kind: 'lines', file: 'a.js', side: 'new', startLine: 5, endLine: 7 }, kind: 'suggestion', body: 'Split the long line into a list.' });
    await mcp('annotate', { review: id, anchor: 'lines', kind: 'question', body: 'Does r7 still need changed8 after it?', file: 'a.js', side: 'new', startLine: 7, endLine: 9 }, rev);
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
    await mcp('annotate', { review: un.id, anchor: 'lines', kind: 'finding', severity: 'minor', body: 'Name this better.', file: 'a.js', side: 'new', startLine: 2 }, rev);

    // Highlighting and the Diff options, on their own worktree so the other reviews' files and counts don't move:
    // a range review of hl.ts from the commit that added it (a sha base) to its edit.
    const sx = w.addWorktree('syntax');
    const hlBase = sx.commit({ 'hl.ts': HL_BASE, 'hl.py': PY_BASE }, 'add hl.ts and hl.py');
    sx.commit({ 'hl.ts': HL_HEAD, 'hl.py': PY_HEAD }, 'edit hl.ts and hl.py');
    const syntax = (await call('POST', 'reviews', { project: 'app', worktree: 'syntax', kind: 'range', base: hlBase, recipient: 's-author', title: 'Syntax' })).review;

    // Guided review, on its own worktree so the other reviews' counts don't move: three 60-line files, five hunks (two lines
    // 5 and 50 of each of g1.js and g2.js, line 5 of g3.js), grouped by the author: G1 spans g1.js and g2.js, G2 is one
    // hunk, G3 is one hunk, and g2.js line 50 is ungrouped. An agent comment sits on G1. HEAD then moves past G3's lines
    // without a refresh, so the golden walk refreshes and sees G3 dropped.
    const gw = w.addWorktree('guided');
    const body = (name) => Array.from({ length: 60 }, (_, i) => `${name}_${i + 1}`);
    const gBase = gw.commit(Object.fromEntries(['g1', 'g2', 'g3'].map((n) => [`${n}.js`, `${body(n).join('\n')}\n`])), 'add g files');
    const edited = (n, at) => `${body(n).map((l, i) => (at.includes(i + 1) ? `${l}_edited` : l)).join('\n')}\n`;
    gw.commit({ 'g1.js': edited('g1', [5, 50]), 'g2.js': edited('g2', [5, 50]), 'g3.js': edited('g3', [5]) }, 'edit g files');
    const guided = (await call('POST', 'reviews', { project: 'app', worktree: 'guided', kind: 'range', base: gBase, recipient: 's-author', title: 'Guided' })).review;
    const hunkIds = {};
    for (const f of (await call('GET', `reviews/${guided.id}/diff`)).files) hunkIds[f.path] = f.hunks.map((h) => h.id);
    const description2 = [
      'Tidy `g1.js` near the end.', '', '- a list item', '- another **bold** item', '',
      '<img src=x onerror="window.__xss=1">', '<script>window.__xss=2</script>', '', '[click](javascript:window.__xss=3)',
    ].join('\n');
    await mcp('propose_groups', { review: guided.id, groups: [
      { title: 'Rename the starting values', description: 'Both files start from the renamed values.', hunks: [hunkIds['g1.js'][0], hunkIds['g2.js'][0]] },
      { title: 'Tidy the tail <b>of g1</b>', description: description2, hunks: [hunkIds['g1.js'][1]] },
      { title: 'One-line tweak in g3', description: 'A single hunk.', hunks: [hunkIds['g3.js'][0]] },
    ] }, author);
    await mcp('annotate', { review: guided.id, anchor: 'group', group: 'g1', kind: 'question', body: 'Why do these two files change together?' }, author);
    gw.commit({ 'g3.js': edited('g3', [5]).replace('g3_5_edited', 'g3_5_rewritten') }, 'rewrite g3 hunk');

    const deliver = async (rid) => {
      const { submission } = await call('POST', `reviews/${rid}/submissions`);
      await call('POST', `reviews/${rid}/submissions/${submission.id}/result`, { ok: true });
    };
    // The conductor's review was delivered, then the conductor answered: your turn again.
    const asked = (await call('POST', `reviews/${conducted.id}/threads`, { anchor: { kind: 'lines', file: 'c.js', side: 'new', startLine: 12, endLine: 12 }, kind: 'question', body: 'Is this line needed?' })).thread;
    await deliver(conducted.id);
    await mcp('reply', { review: conducted.id, thread: asked.id, body: 'Yes, the parser reads it.' }, { sessionId: 's-cond', project: '.conduct' });

    // A review of the main checkout, delivered with no answer yet: waiting on the agent.
    w.repo.write('b.js', `${lines(10, 'b')}main edit\n`);
    const main = (await call('POST', 'reviews', { project: 'app', kind: 'uncommitted', recipient: 's-rev', title: 'Main checkout tidy-up' })).review;
    await call('POST', `reviews/${main.id}/threads`, { anchor: { kind: 'lines', file: 'b.js', side: 'new', startLine: 11, endLine: 11 }, kind: 'comment', body: 'Keep this edit.' });
    await deliver(main.id);

    return {
      url: srv.url, mcp, ids: { range: id, uncommitted: un.id, conducted: conducted.id, main: main.id, syntax: syntax.id, guided: guided.id }, call,
      /**
       * Adds a throwaway worktree `spike` with a review titled "Spike experiment" (on demand, so earlier steps never list it).
       * Resolves {id, destroy}; `destroy()` simulates cc deleting the worktree.
       */
      async spike() {
        const wt = w.addWorktree('spike');
        wt.commit({ 'd.js': 'spike\n' }, 'spike');
        const { review: r } = await call('POST', 'reviews', { project: 'app', worktree: 'spike', kind: 'range', base: 'main', title: 'Spike experiment' });
        return { id: r.id, destroy: () => wt.destroy() };
      },
      /**
       * Opens a commit review of the main checkout titled "Old idea" and ages its `lastActivityAt` to 30 days ago in the stored
       * file (the store reads files on every request), so the inbox lists it as stale (on demand, so earlier steps never list it).
       * Resolves the review id.
       */
      async idle() {
        const { review: r } = await call('POST', 'reviews', { project: 'app', kind: 'commit', title: 'Old idea' });
        const file = path.join(w.store.dir, 'reviews', `${r.id}.json`);
        const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
        stored.lastActivityAt = new Date(Date.now() - 30 * 24 * 3_600_000).toISOString();
        fs.writeFileSync(file, JSON.stringify(stored));
        return r.id;
      },
      /**
       * Adds a worktree `big` with a review of `big.js`, a 11200-line file with one line changed at 1005 and one at 11005, so the
       * hunks show 4- and 5-digit line numbers (on demand, so earlier steps never list it). Resolves the review id.
       */
      async bigFile() {
        const wb = w.addWorktree('big');
        const text = (edits) => `${Array.from({ length: 11200 }, (_, i) => edits[i + 1] ?? `l${i + 1}`).join('\n')}\n`;
        // mid.js: a short file with a three-digit line (the stock gutter), in the same review.
        const mid = (edit) => `${Array.from({ length: 150 }, (_, i) => (i + 1 === 105 ? edit : `m${i + 1}`)).join('\n')}\n`;
        const base = wb.commit({ 'big.js': text({}), 'mid.js': mid('m105') }, 'add big.js and mid.js');
        wb.commit({ 'big.js': text({ 1005: 'changed1005', 11005: 'changed11005' }), 'mid.js': mid('changed105') }, 'edit big.js and mid.js');
        const { review: r } = await call('POST', 'reviews', { project: 'app', worktree: 'big', kind: 'range', base, title: 'Big file' });
        return r.id;
      },
      /** Commits a file under a long directory path to `feature` and refreshes the `range` review: the first undecided file in tree order. Resolves its path. */
      async longPath() {
        const p = 'packages/a-very-long-directory-name-for-the-layout-check/another-long-directory-segment/components/ReviewOverviewHeaderButtonLayoutFixture.tsx';
        wt.commit({ [p]: 'export const fixture = 1;\n' }, 'long path');
        await call('POST', `reviews/${id}/refresh`);
        return p;
      },
      /** Makes the fake cc refuse every exec as SYSTEM_UNREACHABLE (true) or run them again (false). */
      /** Commits files to a seeded worktree (`feature`, `syntax` or `guided`); a review of it changes only when refreshed. */
      commit: (name, files, message = 'change') => ({ feature: wt, syntax: sx, guided: gw })[name].commit(files, message),
      /** Adds a session to the fake cc (it shows up on the next page load). */
      session: (id, opts) => w.session(id, opts),
      systemDown(down) { w.cc.state.execHook = down ? () => ({ status: 502, body: { error: 'provider down', code: 'SYSTEM_UNREACHABLE' } }) : null; },
      async close() { await srv.close(); w.cleanup(); },
    };
  } catch (e) {
    await srv?.close();
    w.cleanup();
    throw e;
  }
}

/**
 * Puts the `range` review ("Feature work") in every thread state, on top of seed(): one human thread is sent in a delivered round
 * and so waits on the agent, another is sent and then answered with a proposed resolution (verify), a fresh human comment is
 * unsent, and the seeded agent threads need a reply. Resolves {proposed, ping}; `ping(body)` makes the author agent reply on
 * the proposed thread, a new agent event for the overview's feed. Called by snap.mjs and golden.mjs's overview step, not by
 * seed(), so earlier steps' counts stay the seed's.
 */
export async function overviewStates(world) {
  const { call, mcp, ids: { range: id } } = world;
  const author = { sessionId: 's-author' };
  const proposed = (await call('POST', `reviews/${id}/threads`, { anchor: { kind: 'file', file: 'c.js' }, kind: 'comment', body: 'Is this file still needed?' })).thread;
  const { submission } = await call('POST', `reviews/${id}/submissions`);
  await call('POST', `reviews/${id}/submissions/${submission.id}/result`, { ok: true });
  await mcp('reply', { review: id, thread: proposed.id, body: 'Dropped the extra line. Resolving.', resolve: true }, author);
  await call('POST', `reviews/${id}/threads`, { anchor: { kind: 'lines', file: 'a.js', side: 'new', startLine: 15, endLine: 15 }, kind: 'comment', body: 'Please add a comment here.' });
  return { proposed: proposed.id, ping: (body = 'Checked again.') => mcp('reply', { review: id, thread: proposed.id, body }, author) };
}
