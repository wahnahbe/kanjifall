import { toHiragana, toKatakana } from 'wanakana';
import type { AirborneWord } from './types';

/**
 * Canonical comparison form for readings. The katakana round-trip makes
 * long-vowel marks (ー) resolve identically whether the source was
 * hiragana, katakana, or an IME buffer (spec §3.5 katakana mitigation).
 */
export function normalizeReading(s: string): string {
  return toHiragana(toKatakana(s.trim()));
}

/** Kana-only prefix of a buffer that may end in unconverted romaji. */
function convertedPrefix(kanaBuffer: string): string {
  return kanaBuffer.replace(/[a-z-]+$/i, '');
}

export function findExactMatches(
  kanaBuffer: string,
  words: readonly AirborneWord[],
): AirborneWord[] {
  const target = normalizeReading(kanaBuffer);
  if (target.length === 0) return [];
  return words.filter((w) => w.card.kana.some((r) => normalizeReading(r) === target));
}

export function findPrefixMatches(
  kanaBuffer: string,
  words: readonly AirborneWord[],
): AirborneWord[] {
  const prefix = normalizeReading(convertedPrefix(kanaBuffer));
  if (prefix.length === 0) return [];
  return words.filter((w) =>
    w.card.kana.some((r) => normalizeReading(r).startsWith(prefix)),
  );
}

/** Homophone rule (spec §3.1): the word closest to the floor dies. */
export function selectTarget(matches: readonly AirborneWord[]): AirborneWord | null {
  if (matches.length === 0) return null;
  return matches.reduce((lowest, w) => (w.y > lowest.y ? w : lowest));
}
