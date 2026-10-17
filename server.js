import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiRouter } from './src/routes.js';
import { migrateStore } from './src/migrate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'frontend', 'dist');
export const DEFAULT_PORT = 7400;
export const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; object-src 'none'; form-action 'self'";

export function createApp({ distDir = dist } = {}) {
  const app = express();
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/api', apiRouter());
  // Anything the API does not route is a 404, never the UI.
  app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }));

  if (fs.existsSync(path.join(distDir, 'index.html'))) {
    app.use((_req, res, next) => { res.set('Content-Security-Policy', CSP); next(); });
    app.use(express.static(distDir));
  } else {
    console.error(`UI not built: ${path.join(distDir, 'index.html')} is missing — run npm install`);
    app.use((_req, res) => res.status(503).type('text/plain').send('UI not built — run npm install'));
  }
  return app;
}

/** Migrates the store, then listens on loopback only; resolves to the http.Server once bound. */
export async function start({ port = Number(process.env.PORT) || DEFAULT_PORT, ...opts } = {}) {
  await migrateStore();
  return new Promise((resolve, reject) => {
    const server = createApp(opts).listen(port, '127.0.0.1', () => resolve(server));
    server.once('error', reject);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await start();
  console.log(`code-review listening on http://127.0.0.1:${server.address().port}`);
}
