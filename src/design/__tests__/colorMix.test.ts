import { describe, expect, it } from 'vitest';
import { mixColor } from '../colorMix';
import { cssRgba, PALETTE } from '../palette';

describe('mixColor', () => {
  it('returns the endpoints at t=0 and t=1', () => {
    expect(mixColor(PALETTE.system, PALETTE.danger, 0)).toBe(PALETTE.system);
    expect(mixColor(PALETTE.system, PALETTE.danger, 1)).toBe(PALETTE.danger);
  });
  it('lerps each channel and rounds', () => {
    expect(mixColor(0x000000, 0xffffff, 0.5)).toBe(0x808080);
    expect(mixColor(0xff0000, 0x0000ff, 0.25)).toBe(0xbf0040);
  });
  it('clamps t', () => {
    expect(mixColor(0x000000, 0xffffff, 2)).toBe(0xffffff);
    expect(mixColor(0x000000, 0xffffff, -1)).toBe(0x000000);
  });
});

describe('cssRgba', () => {
  it('renders a palette number as rgba()', () => {
    expect(cssRgba(PALETTE.system, 0.5)).toBe('rgba(0, 229, 255, 0.5)');
  });
});
