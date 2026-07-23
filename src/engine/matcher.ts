import { toHiragana, toKatakana, toRomaji } from 'wanakana';
import type { AirborneWord } from './types';

/**
 * Canonical comparison form for readings. The katakana round-trip makes
 * long-vowel marks (ー) resolve identically whether the source was
 * hiragana, katakana, or an IME buffer (spec §3.5 katakana mitigation).
 */
export function normalizeReading(s: string): string {
  return toHiragana(toKatakana(s.trim()));
}

/**
 * Phonetic canonicalization on top of script normalization: づ/ず and ぢ/じ
 * are pronounced identically, so typing-by-sound must not distinguish them.
 */
function canonical(s: string): string {
  return normalizeReading(s).replace(/づ/g, 'ず').replace(/ぢ/g, 'じ');
}

const HIRAGANA_VOWEL: Record<string, string> = { a: 'あ', i: 'い', u: 'う', e: 'え', o: 'お' };
const NA_ROW_VOWEL: Record<string, string> = { な: 'あ', に: 'い', ぬ: 'う', ね: 'え', の: 'お' };
const NYA_ROW_PLAIN: Record<string, string> = { にゃ: 'や', にゅ: 'ゆ', にょ: 'よ' };

/** The plain vowel kana that extends `prev` under a literal ー expansion. */
function literalVowel(prev: string): string {
  const last = toRomaji(prev).slice(-1).toLowerCase();
  return HIRAGANA_VOWEL[last] ?? '';
}

/**
 * コーヒー typed the natural way ("koohii") arrives as こおひい — the ー
 * replaced by the previous mora's literal vowel. wanakana's default ー
 * expansion instead yields こうひい, so both forms must be accepted.
 */
function expandLongVowelsLiteral(reading: string): string {
  let s = toKatakana(reading.trim());
  let prev = '';
  while (s.includes('ー') && s !== prev) {
    prev = s;
    s = s.replace(/([^ー])ー/, (_, p: string) => p + toKatakana(literalVowel(p)));
  }
  return canonical(s);
}

/**
 * おんな typed the universal IME way ("onna") arrives as おんあ, because
 * wanakana's IME mode always pairs "nn" into ん and leaves the vowel bare.
 * This produces that naive-typing variant of a reading for acceptance.
 */
function geminateNaiveVariant(s: string): string {
  return s
    .replace(/ん(に[ゃゅょ])/g, (_, nya: string) => `ん${NYA_ROW_PLAIN[nya]}`)
    .replace(/ん([なにぬねの])/g, (_, na: string) => `ん${NA_ROW_VOWEL[na]}`);
}

/**
 * Every comparison form a reading is accepted under: the canonical form plus
 * naive-typing variants (literal ー expansion, geminate-n). Exact canonical
 * matches always outrank variant matches — see findExactMatches.
 */
export function readingForms(reading: string): string[] {
  const forms = new Set<string>([canonical(reading)]);
  if (toKatakana(reading.trim()).includes('ー')) {
    forms.add(expandLongVowelsLiteral(reading));
  }
  for (const form of [...forms]) {
    const naive = geminateNaiveVariant(form);
    if (naive !== form) forms.add(naive);
  }
  return [...forms];
}

/** Kana-only prefix of a buffer that may end in unconverted romaji. */
function convertedPrefix(kanaBuffer: string): string {
  return kanaBuffer.replace(/[a-z-]+$/i, '');
}

/**
 * Two tiers: words whose canonical reading equals the buffer win outright;
 * naive-typing variants are consulted only when no canonical match exists,
 * so a variant can never steal a kill from the word actually typed
 * (きんえん kills 禁煙, never 近年, when both are airborne).
 *
 * Known complete collision set (verified by scanning all 4,678 cards): only
 * 親友(しんゆう)/侵入(しんにゅう) and 単位(たんい)/単に(たんに) collide —
 * typing the shorter exact reading kills the exact word; the geminate word
 * stays reachable via explicit nn (しんnにゅう → shinnnyuu, たんnに → tannni).
 */
export function findExactMatches(
  kanaBuffer: string,
  words: readonly AirborneWord[],
): AirborneWord[] {
  const target = canonical(kanaBuffer);
  if (target.length === 0) return [];
  const exact = words.filter((w) => w.card.kana.some((r) => canonical(r) === target));
  if (exact.length > 0) return exact;
  return words.filter((w) => w.card.kana.some((r) => readingForms(r).includes(target)));
}

export function findPrefixMatches(
  kanaBuffer: string,
  words: readonly AirborneWord[],
): AirborneWord[] {
  const prefix = canonical(convertedPrefix(kanaBuffer));
  if (prefix.length === 0) return [];
  return words.filter((w) =>
    w.card.kana.some((r) => readingForms(r).some((form) => form.startsWith(prefix))),
  );
}

/**
 * Homophone rule (spec §3.1): the word closest to the floor dies.
 * Equal-y ties resolve to the first match in array order (spawn order).
 */
export function selectTarget(matches: readonly AirborneWord[]): AirborneWord | null {
  if (matches.length === 0) return null;
  return matches.reduce((lowest, w) => (w.y > lowest.y ? w : lowest));
}
