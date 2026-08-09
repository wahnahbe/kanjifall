import { describe, expect, it } from 'vitest';
import type { Settings } from '../../data/settings';
import { filterKinds } from '../filters';

const base: Settings = { sound: true, volume: 0.6, effects: 'full', crt: false };

describe('filterKinds (juice-pass spec §5.2)', () => {
  it('full → bloom; full+crt → both; reduced+crt → crt only; off → none', () => {
    expect(filterKinds(base)).toEqual(['bloom']);
    expect(filterKinds({ ...base, crt: true })).toEqual(['bloom', 'crt']);
    expect(filterKinds({ ...base, effects: 'reduced', crt: true })).toEqual(['crt']);
    expect(filterKinds({ ...base, effects: 'off' })).toEqual([]);
  });
});
