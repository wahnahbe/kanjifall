import { getSettings } from '../data/settings';

/**
 * Synthesized SFX (juice-pass spec §4): no assets, all voices are small
 * oscillator + envelope recipes on a lazily-created AudioContext. Every
 * trigger sits downstream of a user key press, so autoplay policy is
 * satisfied; a missing or broken AudioContext makes every call a silent
 * no-op, and sound:false short-circuits before any node exists.
 */

/** Pitch for the kill blip: a semitone per combo step above A4, capped one
 *  octave (spec §4.1). Pure — unit-tested directly. */
export function comboPitch(combo: number): number {
  return 440 * 2 ** (Math.min(Math.max(combo, 0), 12) / 12);
}

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function ensureContext(): { ctx: AudioContext; master: GainNode } | null {
  if (typeof AudioContext === 'undefined') return null;
  if (ctx === null) {
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.connect(ctx.destination);
    } catch {
      ctx = null;
      master = null;
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  master!.gain.value = getSettings().volume;
  return { ctx, master: master! };
}

interface NoteSpec {
  type: OscillatorType;
  freq: number;
  startMs: number;
  durMs: number;
  peak?: number;
  endFreq?: number;
}

function playNotes(notes: readonly NoteSpec[]): void {
  if (!getSettings().sound) return; // BEFORE ensureContext — mute never builds audio
  const audio = ensureContext();
  if (audio === null) return;
  const t0 = audio.ctx.currentTime;
  for (const note of notes) {
    const osc = audio.ctx.createOscillator();
    const gain = audio.ctx.createGain();
    osc.type = note.type;
    const start = t0 + note.startMs / 1000;
    const end = start + note.durMs / 1000;
    osc.frequency.setValueAtTime(note.freq, start);
    if (note.endFreq !== undefined) osc.frequency.exponentialRampToValueAtTime(note.endFreq, end);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(note.peak ?? 0.25, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, end);
    osc.connect(gain);
    gain.connect(audio.master);
    osc.start(start);
    osc.stop(end + 0.02);
  }
}

export const sfx = {
  kill(combo: number): void {
    playNotes([{ type: 'triangle', freq: comboPitch(combo), startMs: 0, durMs: 90 }]);
  },
  miss(): void {
    playNotes([{ type: 'sawtooth', freq: 160, endFreq: 70, startMs: 0, durMs: 320, peak: 0.3 }]);
  },
  wrongSubmit(): void {
    playNotes([
      { type: 'square', freq: 220, startMs: 0, durMs: 60, peak: 0.12 },
      { type: 'square', freq: 196, startMs: 90, durMs: 60, peak: 0.12 },
    ]);
  },
  waveClear(): void {
    playNotes([
      { type: 'triangle', freq: 523.25, startMs: 0, durMs: 110 },
      { type: 'triangle', freq: 659.25, startMs: 110, durMs: 110 },
      { type: 'triangle', freq: 783.99, startMs: 220, durMs: 160 },
    ]);
  },
  gameOver(): void {
    playNotes([
      { type: 'sawtooth', freq: 392, startMs: 0, durMs: 180, peak: 0.2 },
      { type: 'sawtooth', freq: 311.13, startMs: 180, durMs: 180, peak: 0.2 },
      { type: 'sawtooth', freq: 261.63, startMs: 360, durMs: 320, peak: 0.2 },
    ]);
  },
  ceremonyChime(): void {
    playNotes([
      { type: 'sine', freq: 880, startMs: 0, durMs: 240, peak: 0.15 },
      { type: 'sine', freq: 1318.5, startMs: 60, durMs: 300, peak: 0.1 },
    ]);
  },
  tierFanfare(): void {
    playNotes([
      { type: 'triangle', freq: 523.25, startMs: 0, durMs: 140 },
      { type: 'triangle', freq: 659.25, startMs: 140, durMs: 140 },
      { type: 'triangle', freq: 783.99, startMs: 280, durMs: 140 },
      { type: 'triangle', freq: 1046.5, startMs: 420, durMs: 420, peak: 0.3 },
      { type: 'sine', freq: 2093, startMs: 460, durMs: 380, peak: 0.08 },
    ]);
  },
};
export type Sfx = typeof sfx;
