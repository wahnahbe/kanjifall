import { describe, expect, it } from 'vitest';
import { attempts } from '../db/schema';
import { groupByCard } from '../cardScoring';

type AttemptRow = typeof attempts.$inferSelect;

let nextId = 1;
function fakeAttempt(overrides: Partial<AttemptRow> = {}): AttemptRow {
  return {
    id: nextId++,
    runId: 'run-x',
    cardId: 'card-x',
    mode: 'reading',
    outcome: 'kill',
    msToFirstKey: 100,
    msToKill: 900,
    backspaceCount: 0,
    hintShown: false,
    wasTargeted: true,
    airborneCount: 1,
    speedLevel: 1,
    createdAt: 1_000_000,
    ...overrides,
  };
}

describe('groupByCard', () => {
  it('buckets a recognized mode into its direction array; an unrecognized mode lands only in "all"', () => {
    // `mode` is a plain `string` column (no DB-level CHECK constraint) — this exercises the fallthrough
    // when neither 'reading' nor 'recall' matches, rather than assuming the zod-validated ingest path
    // is the only way a row can ever get created.
    const known = fakeAttempt({ cardId: 'c1', mode: 'reading' });
    const corrupt = fakeAttempt({ cardId: 'c1', mode: 'listening' });
    const grouped = groupByCard([known, corrupt]);
    const group = grouped.get('c1')!;
    expect(group.all).toHaveLength(2);
    expect(group.reading).toEqual([known]);
    expect(group.recall).toHaveLength(0);
  });
});
