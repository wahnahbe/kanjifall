import { describe, expect, it } from 'vitest';
import { pipStates } from '../pips';

describe('pipStates (visual-identity spec §6)', () => {
  it('shows spent pips so the total stays readable', () => {
    expect(pipStates(2)).toEqual(['live', 'live', 'spent']);
  });

  it('is all live at full health', () => {
    expect(pipStates(3)).toEqual(['live', 'live', 'live']);
  });

  it('clamps negative lives to none live', () => {
    expect(pipStates(-1)).toEqual(['spent', 'spent', 'spent']);
  });

  it('never exceeds max', () => {
    expect(pipStates(9)).toHaveLength(3);
    expect(pipStates(9, 5)).toHaveLength(5);
  });
});
