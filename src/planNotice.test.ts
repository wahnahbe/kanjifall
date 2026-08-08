import { describe, expect, it } from 'vitest';
import type { FetchedPlan } from './data/planClient';
import type { TierProgress } from './shared/api';
import { noticeFor } from './planNotice';

const tier = (over: Partial<TierProgress> = {}): TierProgress => ({
  level: 5, index: 1, totalTiers: 64, size: 10, solid: 0, amnestied: 0, unreachable: 0, ...over,
});

const fetchedOf = (over: Partial<FetchedPlan> = {}): FetchedPlan => ({
  newCardIds: [], seenCards: [], runBudget: 0, perWaveNewCap: 2, tiers: [tier()], ...over,
});

describe('noticeFor (spec §5.4)', () => {
  it('no plan: server-absent notice', () => {
    expect(noticeFor(null)).toBe('Word introductions need the server — playing without them.');
  });

  it('budget remaining with eligible new cards: no notice', () => {
    expect(noticeFor(fetchedOf({ newCardIds: ['a'], runBudget: 3 }))).toBeNull();
    expect(
      noticeFor(fetchedOf({ newCardIds: ['a'], runBudget: 3, seenCards: [{ id: 'b', weight: 1 }] })),
    ).toBeNull();
  });

  it('starved pool: budget spent, new cards exist, nothing ever met (§3.2)', () => {
    expect(noticeFor(fetchedOf({ newCardIds: ['a'], runBudget: 0 }))).toBe(
      "Today's new words are done, and you haven't met anything in this pool yet — playing without introductions.",
    );
  });

  it('budget exhausted with history: ordinary review notice', () => {
    expect(
      noticeFor(fetchedOf({ newCardIds: ['a'], runBudget: 0, seenCards: [{ id: 'b', weight: 1 }] })),
    ).toBe("Today's new words are done — this run is review.");
  });

  it('level complete (single-level pool): every tier cleared', () => {
    const plan = fetchedOf({
      runBudget: 3,
      seenCards: [{ id: 'b', weight: 1 }],
      tiers: [tier({ index: null, size: 0 })],
    });
    expect(noticeFor(plan)).toBe("You've cleared every N5 tier — this run is review.");
  });

  it('level complete (mixed): generic copy once ALL levels are done', () => {
    const plan = fetchedOf({
      seenCards: [{ id: 'b', weight: 1 }],
      tiers: [
        tier({ level: 5, index: null, size: 0 }),
        tier({ level: 4, index: null, size: 0 }),
        tier({ level: 3, index: null, size: 0 }),
        tier({ level: 2, index: null, size: 0 }),
      ],
    });
    expect(noticeFor(plan)).toBe("You've cleared every tier in this pool — this run is review.");
  });

  it('tier gated beats budget exhausted: structural reasons outrank temporal ones', () => {
    // Active tier fully introduced (no eligible new), gate not passed, AND
    // budget spent: the gate message is the honest one — "more tomorrow"
    // would be false (§5.4 precedence).
    const plan = fetchedOf({
      runBudget: 0,
      seenCards: [{ id: 'b', weight: 1 }],
      tiers: [tier({ index: 4, solid: 6 })],
    });
    expect(noticeFor(plan)).toBe("Tier 4 isn't solid yet — this run is review.");
    // Same structural state with budget remaining: same message.
    expect(noticeFor(fetchedOf({
      runBudget: 3,
      seenCards: [{ id: 'b', weight: 1 }],
      tiers: [tier({ index: 4, solid: 6 })],
    }))).toBe("Tier 4 isn't solid yet — this run is review.");
  });

  it('tier gated in mixed names the first gated level', () => {
    const plan = fetchedOf({
      seenCards: [{ id: 'b', weight: 1 }],
      tiers: [
        tier({ level: 5, index: null, size: 0 }),
        tier({ level: 4, index: 2 }),
        tier({ level: 3, index: 1 }),
        tier({ level: 2, index: 1 }),
      ],
    });
    expect(noticeFor(plan)).toBe("N4 tier 2 isn't solid yet — this run is review.");
  });

  it('tier gated in mixed is level-ordered regardless of array order', () => {
    // Deliberately N2→N5 (reverse of the server's usual pool order): an
    // unsorted `.find()` would name N2 (the first array entry with a
    // non-null index) instead of N4, so this fails unless noticeFor sorts
    // by level before scanning.
    const plan = fetchedOf({
      seenCards: [{ id: 'b', weight: 1 }],
      tiers: [
        tier({ level: 2, index: 1 }),
        tier({ level: 3, index: 1 }),
        tier({ level: 4, index: 2 }),
        tier({ level: 5, index: null, size: 0 }),
      ],
    });
    expect(noticeFor(plan)).toBe("N4 tier 2 isn't solid yet — this run is review.");
  });
});
