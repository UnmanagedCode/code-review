import http from 'node:http';

/**
 * A fake cc REST host. `fixture` is mutable: {projects, worktrees:{project:[rows]}, instances}.
 * `mode` is 'ok' | 'error' | 'hang'. Sets CONDUCTOR_URL; `close()` restores it.
 */
export async function fakeCc(fixture = {}) {
  const state = { projects: [], worktrees: {}, instances: [], mode: 'ok', ...fixture };
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    if (state.mode === 'hang') return;
    if (state.mode === 'error') { res.statusCode = 500; return res.end('{}'); }
    const url = new URL(req.url, 'http://x');
    const send = (body) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
    if (url.pathname === '/api/projects') return send(state.projects);
    if (url.pathname === '/api/instances') return send(state.instances);
    const m = url.pathname.match(/^\/api\/projects\/([^/]+)\/worktrees$/);
    if (m) return send(state.worktrees[decodeURIComponent(m[1])] ?? []);
    res.statusCode = 404; res.end('{}');
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const prev = process.env.CONDUCTOR_URL;
  process.env.CONDUCTOR_URL = `http://127.0.0.1:${server.address().port}`;
  return {
    state,
    close() {
      if (prev === undefined) delete process.env.CONDUCTOR_URL; else process.env.CONDUCTOR_URL = prev;
      for (const s of sockets) s.destroy();
      server.close();
    },
  };
}
