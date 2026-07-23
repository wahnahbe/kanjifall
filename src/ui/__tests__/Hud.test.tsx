// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { EngineSnapshot } from '../../engine/types';
import { Hud } from '../hud/Hud';

const snapshot: EngineSnapshot = {
  status: 'playing', mode: 'reading', score: 1230, lives: 2, wave: 3, combo: 4, maxCombo: 0,
  kills: 0, wrongSubmits: 0,
  bufferKana: 'べんk', bufferRomaji: 'benk', lockedIds: [1], missed: [], timeMs: 0,
};

describe('Hud', () => {
  it('renders score, lives, wave, combo, and the kana buffer', () => {
    render(<Hud snapshot={snapshot} />);
    expect(screen.getByTestId('score')).toHaveTextContent('1230');
    expect(screen.getByTestId('lives')).toHaveTextContent('♥♥');
    expect(screen.getByTestId('wave')).toHaveTextContent('3');
    expect(screen.getByTestId('combo')).toHaveTextContent('4');
    expect(screen.getByTestId('kana-buffer')).toHaveTextContent('べんk');
  });
});
