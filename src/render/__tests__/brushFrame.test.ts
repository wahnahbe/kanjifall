import { describe, expect, it } from 'vitest';
import { brushFrameDataUri } from '../brushStroke';

describe('brushFrameDataUri (second-pass spec §3.2)', () => {
  const uri = brushFrameDataUri(7, { width: 200, height: 40 });

  it('returns an inline SVG data URI sized to the box', () => {
    expect(uri).toMatch(/^data:image\/svg\+xml,/);
    expect(uri).toContain("width='200'");
    expect(uri).toContain("height='40'");
    expect(uri).toContain("preserveAspectRatio='none'");
  });

  it('is colour-free: it is a mask, and colour comes from the token behind it', () => {
    expect(uri).toContain("stroke='white'");
    expect(uri).not.toMatch(/%23[0-9a-f]{6}/i);
  });

  it('is a stroked outline, not a fill', () => {
    expect(uri).toContain("fill='none'");
    expect(uri).toContain('stroke-width');
  });

  it('varies with the seed and is stable for a seed', () => {
    expect(brushFrameDataUri(7, { width: 200, height: 40 })).toBe(uri);
    expect(brushFrameDataUri(8, { width: 200, height: 40 })).not.toBe(uri);
  });

  it('leaves no raw characters that break a data URI', () => {
    for (const illegal of ['<', '>', '"', '#']) expect(uri).not.toContain(illegal);
  });
});
