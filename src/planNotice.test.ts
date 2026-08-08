import { describe, expect, it } from 'vitest';
import type { EnginePlan } from './engine/types';
import { noticeFor } from './planNotice';

const planOf = (newCardIds: string[], runBudget: number): EnginePlan => ({
  newCardIds, seenCards: [], runBudget, perWaveNewCap: 2,
});

describe('noticeFor', () => {
  it('no plan: server-absent notice', () => {
    expect(noticeFor(null, false)).toBe('Word introductions need the server — playing without them.');
  });

  it('budget remaining: no notice', () => {
    expect(noticeFor(planOf(['a'], 3), false)).toBeNull();
    expect(noticeFor(planOf(['a'], 3), true)).toBeNull();
  });

  it('budget spent, new cards exist, seen pool is empty: the starved-pool notice (spec §3.2)', () => {
    expect(noticeFor(planOf(['a'], 0), true)).toBe(
      "Today's new words are done, and you haven't met anything in this pool yet — playing without introductions.",
    );
  });

  it('budget spent, new cards exist, seen pool is non-empty: ordinary review notice', () => {
    expect(noticeFor(planOf(['a'], 0), false)).toBe("Today's new words are done — this run is review.");
  });

  it('budget spent, no new cards left at all: no notice (the pool is fully met, ordinary review)', () => {
    expect(noticeFor(planOf([], 0), false)).toBeNull();
    expect(noticeFor(planOf([], 0), true)).toBeNull();
  });
});
