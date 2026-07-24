import { describe, expect, it } from 'vitest';
import { localDateKey, startOfLocalDay } from '../dates';

describe('local date helpers', () => {
  it('formats a local calendar date as YYYY-MM-DD', () => {
    const noonLocal = new Date(2026, 7, 1, 12, 0, 0).getTime(); // Aug 1 2026, local noon
    expect(localDateKey(noonLocal)).toBe('2026-08-01');
  });

  it('agrees with the local calendar at both ends of a local day', () => {
    const startOfDay = new Date(2026, 7, 1, 0, 0, 0).getTime();
    const endOfDay = new Date(2026, 7, 1, 23, 59, 59).getTime();
    expect(localDateKey(startOfDay)).toBe('2026-08-01');
    expect(localDateKey(endOfDay)).toBe('2026-08-01');
    // One millisecond later is the next local day.
    expect(localDateKey(endOfDay + 1000)).toBe('2026-08-02');
  });

  it('startOfLocalDay returns local midnight and is idempotent', () => {
    const evening = new Date(2026, 7, 1, 22, 30, 0).getTime();
    const midnight = startOfLocalDay(evening);
    expect(new Date(midnight).getHours()).toBe(0);
    expect(new Date(midnight).getMinutes()).toBe(0);
    expect(localDateKey(midnight)).toBe('2026-08-01');
    expect(startOfLocalDay(midnight)).toBe(midnight);
  });
});
