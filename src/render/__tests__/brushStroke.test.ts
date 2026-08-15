import { describe, expect, it } from 'vitest';
import { brushStrokeDataUri } from '../brushStroke';

describe('brushStrokeDataUri (visual-identity spec §5.2)', () => {
  it('returns an inline SVG data URI', () => {
    expect(brushStrokeDataUri('#00e5ff', 11)).toMatch(/^data:image\/svg\+xml,/);
  });

  it('encodes the colour, percent-escaping the hash', () => {
    expect(brushStrokeDataUri('#00e5ff', 11)).toContain('%2300e5ff');
    expect(brushStrokeDataUri('#00e5ff', 11)).not.toContain('#00e5ff');
  });

  it('varies with the seed, so two strokes differ', () => {
    expect(brushStrokeDataUri('#00e5ff', 11)).not.toBe(brushStrokeDataUri('#00e5ff', 12));
  });

  it('leaves no raw characters that break an SVG data URI', () => {
    const uri = brushStrokeDataUri('#ff2a3c', 4);
    for (const illegal of ['<', '>', '"', '#']) {
      expect(uri).not.toContain(illegal);
    }
  });
});
