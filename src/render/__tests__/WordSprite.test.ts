import { describe, expect, it } from 'vitest';
import { chromaticSplitAllowed } from '../WordSprite';

describe('chromaticSplitAllowed (visual-identity spec §9.1)', () => {
  it('forbids the split just below the play font size', () => {
    expect(chromaticSplitAllowed(39)).toBe(false);
  });

  it('allows the split at the play font size', () => {
    expect(chromaticSplitAllowed(40)).toBe(true);
  });
});
