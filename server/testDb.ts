import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect, type DbHandle } from './db/connect';

export function makeTestDb(): { handle: DbHandle; cleanup(): void } {
  const dir = mkdtempSync(join(tmpdir(), 'kotoba-test-'));
  const handle = connect(join(dir, 'test.db'));
  return {
    handle,
    cleanup(): void {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
