import type { Card } from '../engine/types.ts';

/**
 * Mirrors cardSchema's gloss max (src/data/schema.ts) — the same deliberate
 * duplication as GLOSS_MAX in scripts/build-data.ts: a joined gloss must
 * still pass the schema gate the build writes through.
 */
const GLOSS_MAX = 28;

export interface HomographMergeResult {
  cards: Card[];
  merges: string[];
}

/** Numeric body of a jm-<digits> id; NaN-safe fallback handled by caller. */
function idNumber(id: string): number {
  return Number(id.replace(/^jm-/, ''));
}

/**
 * Survivor preference: a jmdict-common card beats a rare one (it keeps the
 * better tier tiebreak in assignTiers), then the lower entry id wins — older
 * JMdict ids correlate with core vocabulary, which picks わたし over
 * わたくし and なに over なん.
 */
function bySurvivorPreference(isCommon: (id: string) => boolean) {
  return (a: Card, b: Card): number => {
    const commonDiff = Number(isCommon(b.id)) - Number(isCommon(a.id));
    if (commonDiff !== 0) return commonDiff;
    const aNum = idNumber(a.id);
    const bNum = idNumber(b.id);
    if (Number.isFinite(aNum) && Number.isFinite(bNum) && aNum !== bNum) return aNum - bNum;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
}

/** Twin readings append after the survivor's; kana[0] stays canonical. */
function mergeKana(survivor: Card, twins: readonly Card[]): string[] {
  const kana = [...survivor.kana];
  for (const twin of twins) {
    for (const reading of twin.kana) {
      if (!kana.includes(reading)) kana.push(reading);
    }
  }
  return kana;
}

/**
 * Joins distinct glosses with " / " while the result still fits the schema's
 * 28-char cap; a twin gloss that would overflow is dropped rather than
 * truncated mid-meaning (its reading is still accepted — the gloss just
 * shows the survivor's primary sense).
 */
function mergeGloss(survivor: Card, twins: readonly Card[]): string {
  let gloss = survivor.gloss;
  for (const twin of twins) {
    if (gloss === twin.gloss || gloss.split(' / ').includes(twin.gloss)) continue;
    const joined = `${gloss} / ${twin.gloss}`;
    if (joined.length <= GLOSS_MAX) gloss = joined;
  }
  return gloss;
}

/**
 * Collapses cards that share a kanji within one level file into a single
 * card accepting every reading. Reading mode displays only the kanji
 * (src/render/WordSprite.ts), so two cards with the same kanji are visually
 * identical yet each accepts only its own readings — typing the other card's
 * perfectly correct reading does nothing. One card per displayed form
 * removes that trap (and the duplicate acquisition ceremony with it).
 *
 * Kana-only cards are exempt: they display their reading itself, and
 * same-reading kana words are already handled airborne by the homophone
 * rule (matcher spec §3.1). Pure function: inputs are never mutated.
 */
export function mergeLevelHomographs(
  cards: readonly Card[],
  isCommon: (id: string) => boolean,
): HomographMergeResult {
  const byKanji = new Map<string, Card[]>();
  for (const card of cards) {
    if (card.kanji === null) continue;
    const group = byKanji.get(card.kanji);
    if (group) group.push(card);
    else byKanji.set(card.kanji, [card]);
  }

  const survivors = new Map<string, Card>();
  const absorbed = new Set<string>();
  const merges: string[] = [];
  for (const [kanji, group] of byKanji) {
    if (group.length < 2) continue;
    const [survivor, ...twins] = [...group].sort(bySurvivorPreference(isCommon));
    survivors.set(survivor.id, {
      ...survivor,
      kana: mergeKana(survivor, twins),
      gloss: mergeGloss(survivor, twins),
    });
    for (const twin of twins) {
      absorbed.add(twin.id);
      merges.push(
        `merged homograph ${twin.id} (${kanji} ${twin.kana[0]}, ${twin.gloss}) into ${survivor.id} (${survivor.kana[0]})`,
      );
    }
  }

  return {
    cards: cards.filter((c) => !absorbed.has(c.id)).map((c) => survivors.get(c.id) ?? c),
    merges,
  };
}
