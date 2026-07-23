import { serve } from '@hono/node-server';
import { buildApp } from './app';
import { connect, DbOpenError } from './db/connect';

const dbPath = process.env.KOTOBA_DB ?? 'data/kotoba.db';
const port = Number(process.env.KOTOBA_PORT ?? 8790);

let handle;
try {
  handle = connect(dbPath);
  console.log(`kotoba-drop api: db ready at ${dbPath}`);
} catch (error: unknown) {
  if (!(error instanceof DbOpenError)) throw error;
  handle = error;
  console.error(`DB UNAVAILABLE: ${error.message}`);
}

serve({ fetch: buildApp(handle).fetch, port }, () => {
  console.log(`kotoba-drop api listening on http://localhost:${port}`);
});
