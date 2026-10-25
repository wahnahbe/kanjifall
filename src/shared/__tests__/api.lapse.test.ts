import { describe, expect, it } from 'vitest';
import { attemptSchema, runPlanSchema } from '../api';

describe('lapse fields default for old payloads', () => {
  it('runPlanSchema fills owned=false when a seen card omits it', () => {
    const plan = runPlanSchema.parse({ newCardIds: [], seenCards: [{ id: 'a', weight: 1 }], runBudget: 0, tiers: [] });
    expect(plan.seenCards[0].owned).toBe(false);
  });
  it('runPlanSchema keeps owned=true', () => {
    const plan = runPlanSchema.parse({ newCardIds: [], seenCards: [{ id: 'a', weight: 1, owned: true }], runBudget: 0, tiers: [] });
    expect(plan.seenCards[0].owned).toBe(true);
  });
  it('attemptSchema fills comeback=false when omitted', () => {
    const a = attemptSchema.parse({ cardId: 'a', mode: 'reading', outcome: 'kill', msToFirstKey: 1, msToKill: 2,
      backspaceCount: 0, hintShown: false, wasTargeted: true, airborneCount: 1, speedLevel: 1, createdAt: 1 });
    expect(a.comeback).toBe(false);
  });
});
