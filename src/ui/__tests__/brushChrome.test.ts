// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { installBrushChrome } from '../brushChrome';

describe('installBrushChrome (second-pass spec §3.2)', () => {
  it('sets the three frame masks as url() custom properties on the root it is given', () => {
    const root = document.createElement('div');
    installBrushChrome(root);
    for (const name of ['--brush-frame-wide', '--brush-frame-tall', '--brush-frame-sign']) {
      const value = root.style.getPropertyValue(name);
      expect(value, name).toMatch(/^url\("data:image\/svg\+xml,/);
      expect(value, name).toContain("stroke='white'");
    }
  });

  it('uses a distinct aspect per mask so strokes do not distort', () => {
    const root = document.createElement('div');
    installBrushChrome(root);
    expect(root.style.getPropertyValue('--brush-frame-wide')).toContain("width='200' height='40'");
    expect(root.style.getPropertyValue('--brush-frame-tall')).toContain("width='260' height='70'");
    expect(root.style.getPropertyValue('--brush-frame-sign')).toContain("width='520' height='220'");
  });
});
