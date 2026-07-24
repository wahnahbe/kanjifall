import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { execFile } from 'node:child_process';
import type { Hono } from 'hono';
import { buildApp } from './app';
import { connect, DbOpenError } from './db/connect';

const dbPath = process.env.KOTOBA_DB ?? 'data/kotoba.db';
const port = Number(process.env.KOTOBA_PORT ?? 8790);
const args = process.argv.slice(2);
const shouldServeDist = args.includes('--dist');
const shouldOpen = args.includes('--open');

function isApiPath(path: string): boolean {
  return path === '/api' || path.startsWith('/api/');
}

/**
 * `npm start`'s single-process mode (design spec §4.1): the built client
 * ships from `./dist` off the same Hono app and port as the API, so there's
 * one process to run instead of two, with no dev-only Vite proxy involved.
 * API routes are already registered on `target` (buildApp) and always
 * produce a response themselves, so they take priority over anything added
 * here; a request under `/api` that reaches this point regardless (i.e., an
 * unknown API path) is explicitly excluded from both the static file server
 * and the SPA fallback rather than being handed index.html.
 */
function attachDistServing(target: Hono): void {
  const root = './dist';
  target.use('*', async (c, next) => {
    if (isApiPath(c.req.path)) return next();
    return serveStatic({ root })(c, next);
  });
  // SPA fallback: any non-API GET that isn't a real file in dist (a
  // client-side route like /stats) resolves to the app shell instead of 404.
  target.get('*', async (c, next) => {
    if (isApiPath(c.req.path)) return next();
    return serveStatic({ root, path: 'index.html' })(c, next);
  });
}

/**
 * Best-effort convenience for `npm start`; a failed launch never blocks the
 * server. Uses execFile (argument array, no shell string) rather than exec:
 * `start` isn't a standalone executable, so Windows routes through cmd.exe,
 * with the URL passed as its own argv entry — not concatenated into a
 * command string — same as the plain `open`/`xdg-open` executable paths.
 */
function openBrowser(url: string): void {
  let command: string;
  let commandArgs: string[];
  if (process.platform === 'win32') {
    command = 'cmd.exe';
    commandArgs = ['/c', 'start', '', url]; // '' is the `start` window-title slot, not the target
  } else if (process.platform === 'darwin') {
    command = 'open';
    commandArgs = [url];
  } else {
    command = 'xdg-open';
    commandArgs = [url];
  }
  execFile(command, commandArgs, (error) => {
    if (error) console.error(`could not open the browser automatically: ${error.message}`);
  });
}

let handle;
try {
  handle = connect(dbPath);
  console.log(`kotoba-drop api: db ready at ${dbPath}`);
} catch (error: unknown) {
  if (!(error instanceof DbOpenError)) throw error;
  handle = error;
  console.error(`DB UNAVAILABLE: ${error.message}`);
}

const app = buildApp(handle);
if (shouldServeDist) attachDistServing(app);

const server = serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => {
  const url = `http://localhost:${port}`;
  console.log(`kotoba-drop api listening on ${url}`);
  if (shouldOpen) openBrowser(url);
});

// A failed bind (EADDRINUSE etc.) must be LOUD and fatal. Without this, the
// listen error escapes the serve callback, tsx watch keeps the process alive
// as a file-watcher zombie, and the game runs happily with no API — the
// Stats screen then blames a server that appears to be "running".
server.on('error', (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`kotoba-drop api FAILED to listen on port ${port}: ${message}`);
  console.error('Is another kotoba-drop instance (npm run dev / npm start / e2e) still running?');
  process.exit(1);
});
