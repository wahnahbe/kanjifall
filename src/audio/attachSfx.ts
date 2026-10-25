import type { GameEvent } from '../engine/types';
import type { Sfx } from './sfx';

/** Passive event consumer (main spec §4 boundary): the in-run moments map
 *  to voices, lapses and relit kills included; mute/volume are enforced
 *  inside the player at play time, so nothing re-wires on settings
 *  changes. Installed in useEngine's onEvent seam alongside the stage
 *  effects. */
export function attachSfx(player: Sfx): (event: GameEvent) => void {
  return (event) => {
    switch (event.type) {
      case 'wordKilled':
        if (event.relit) player.relit(event.combo);
        else player.kill(event.combo);
        break;
      case 'wordMissed':
        if (event.lapse || event.light === 'dark') player.lapse();
        else player.miss();
        break;
      case 'wrongSubmit':
        player.wrongSubmit();
        break;
      case 'waveCleared':
        player.waveClear();
        break;
      case 'gameOver':
        player.gameOver();
        break;
      default:
        break;
    }
  };
}
