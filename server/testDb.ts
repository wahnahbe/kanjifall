import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect, type DbHandle } from './db/connect';

export function makeTestDb(): { handle: DbHandle; dbPath: string; cleanup(): void } {
  const dir = mkdtempSync(join(tmpdir(), 'kotoba-test-'));
  const dbPath = join(dir, 'test.db');
  const handle = connect(dbPath);
  return {
    handle,
    dbPath,
    cleanup(): void {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
