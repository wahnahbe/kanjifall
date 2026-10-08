import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function token(name: string): string {
  const css = readFileSync(join(process.cwd(), 'src/ui/tokens.css'), 'utf8');
  const match = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(css);
  if (match === null) throw new Error(`no ${name}`);
  return match[1].toLowerCase();
}

// Second-pass spec §5.3: 落 is the mark. The asset is generated once by
// scripts/build-favicon.ts and committed; this pins that it is a glyph
// path in the identity's own colours, read from tokens.css, not retyped.
describe('public/favicon.svg', () => {
  const svg = readFileSync(join(process.cwd(), 'public/favicon.svg'), 'utf8').toLowerCase();

  it('is a vector glyph on the ground colour', () => {
    expect(svg).toContain('<path');
    expect(svg).toContain(`fill="${token('--color-ground')}"`);
  });

  it('is filled ink with a system-coloured edge', () => {
    expect(svg).toContain(`fill="${token('--color-ink')}"`);
    expect(svg).toContain(`stroke="${token('--color-system')}"`);
  });

  it('names the glyph so the file is self-describing', () => {
    expect(svg).toContain('<!-- 落');
  });
});
