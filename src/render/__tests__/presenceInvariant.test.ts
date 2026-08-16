import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

/** Visual-identity spec §7's load-bearing invariant: "anything that conveys
 *  game state renders at every effects level; only decoration scales."
 *  `visualParams(effects)` (src/design/visualParams.ts) only ever returns
 *  scalar strengths (chromaticSplitPx, haloAlpha, glowAlpha, grainAlpha) —
 *  it has no boolean "should this render" field, so a unit test confined to
 *  that module can't catch a regression where a *consumer* starts gating
 *  presence on one of those numbers (e.g. `if (glowAlpha > 0) addChild(floor)`).
 *  That bug would live in PixiStage.ts/WordSprite.ts, not visualParams.ts.
 *
 *  This suite tests it where the risk actually is: it parses the real source
 *  of the two Pixi call sites the QA checklist's "load-bearing assertion"
 *  covers (floor+deadline in PixiStage.ts, reticle+underline in
 *  WordSprite.ts) and proves the statements that create/mount those objects
 *  are never lexically inside an `if` that tests `glowAlpha` or `haloAlpha`
 *  — only their `.filters =` glow assignment is allowed to be. A source-AST
 *  check, not a rendered-output check, because Pixi's `Application.init()`
 *  needs a real WebGL/canvas context this repo's test env doesn't provide
 *  (see WordSprite.test.ts/reticle.test.ts: existing Pixi-adjacent tests
 *  stay at the pure-function level for the same reason). The HUD side of the
 *  same invariant (score/wave/lives/buffer) IS reachable through real
 *  rendering — covered by Hud.test.tsx's "presence survives every effects
 *  level" cases instead. */

function parse(relPath: string): { source: ts.SourceFile; text: string } {
  const filePath = join(process.cwd(), relPath);
  const text = readFileSync(filePath, 'utf8');
  return { source: ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true), text };
}

/** True if `node` sits lexically inside an `if (...)` whose condition text
 *  mentions `token` (e.g. an outer `if (this.glowAlpha > 0) { ... }`). */
function isGatedBy(node: ts.Node, token: string): boolean {
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if (ts.isIfStatement(current) && current.expression.getText().includes(token)) return true;
  }
  return false;
}

/** Finds every expression statement in `source` whose exact rendered text
 *  equals `statementText` (e.g. `'this.app.stage.addChild(floor);'`). */
function findStatements(source: ts.SourceFile, statementText: string): ts.Node[] {
  const found: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isExpressionStatement(node) && node.getText() === statementText) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function assertNeverGated(source: ts.SourceFile, statementText: string): void {
  const matches = findStatements(source, statementText);
  expect(matches.length, `expected to find \`${statementText}\` in the source`).toBeGreaterThan(0);
  for (const node of matches) {
    expect(isGatedBy(node, 'glowAlpha'), `\`${statementText}\` must not be gated on glowAlpha`).toBe(false);
    expect(isGatedBy(node, 'haloAlpha'), `\`${statementText}\` must not be gated on haloAlpha`).toBe(false);
  }
}

describe('presence is never gated on a decoration alpha (spec §7)', () => {
  it('PixiStage mounts the floor and the deadline unconditionally', () => {
    const { source } = parse('src/render/PixiStage.ts');
    assertNeverGated(source, 'this.app.stage.addChild(floor);');
    assertNeverGated(source, 'this.app.stage.addChild(deadline);');
  });

  it('WordSprite mounts the target reticle brackets unconditionally', () => {
    const { source } = parse('src/render/WordSprite.ts');
    assertNeverGated(source, 'this.view.addChild(brackets);');
  });

  // Sanity check on the test itself: applyFloorGlow's *filter* assignment
  // legitimately IS gated on glowAlpha (spec §7: "Full glow" / "Reduced
  // glow" / "Flat, no glow" all still render the stroke, just with a
  // different filter). If this ever stopped being true the fixture premise
  // above (there's a real glowAlpha branch nearby, distinct from the
  // presence statements) would be false, and the "unconditional" assertions
  // above would be vacuous rather than meaningful.
  it('the floor glow filter itself IS gated on glowAlpha (control case)', () => {
    const { text } = parse('src/render/PixiStage.ts');
    expect(text).toMatch(/glowAlpha > 0\s*\?/);
  });
});
