export type PipState = 'live' | 'spent';

const DEFAULT_MAX = 3;

/** Lives as pip states. Spent pips stay rendered at low alpha (visual-identity
 *  spec §6) so the player can always read the total, not just what is left. */
export function pipStates(lives: number, max: number = DEFAULT_MAX): PipState[] {
  const live = Math.max(0, Math.min(lives, max));
  return Array.from({ length: max }, (_, i) => (i < live ? 'live' : 'spent'));
}
