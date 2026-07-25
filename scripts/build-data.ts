/**
 * Build public/data/jlpt-n{5,4,3,2}.json from local raw datasets:
 *  - data/raw/term_meta_bank_*.json  (yomitan-jlpt-vocab: term, reading, JLPT level)
 *  - data/raw/jmdict-eng-3.6.2.json  (jmdict-simplified: readings, glosses, POS)
 * No network. Fails hard (exit 1) if any level's match rate drops below 85%.
 * Run: npm run build:data   (if it OOMs: set NODE_OPTIONS=--max-old-space-size=4096)
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { isKana } from 'wanakana';
import { levelFileSchema } from '../src/data/schema.ts';
import type { Card } from '../src/engine/types.ts';

const RAW_DIR = 'data/raw';
const OUT_DIR = 'public/data';
const LIST_VERSION = 'jlpt-tanos-jmdict-3.6.2-v1';
const GLOSS_MAX = 28;
const MIN_MATCH_RATE = 0.85;
const LEVEL_BY_TAG: Record<string, 2 | 3 | 4 | 5> = { N5: 5, N4: 4, N3: 3, N2: 2 };

type MetaEntry = [string, string, { reading: string; frequency: { displayValue: string } }];
interface JlptEntry { term: string; reading: string; level: 2 | 3 | 4 | 5 }

interface JmdictKana { text: string; appliesToKanji: string[] }
interface JmdictGloss { lang: string; text: string }
interface JmdictSense { partOfSpeech: string[]; appliesToKanji: string[]; gloss: JmdictGloss[] }
interface JmdictWord { id: string; kanji: { text: string }[]; kana: JmdictKana[]; sense: JmdictSense[] }

function readJlptEntries(): JlptEntry[] {
  const byKey = new Map<string, JlptEntry>();
  const bankFiles = readdirSync(RAW_DIR).filter((f) => /^term_meta_bank_\d+\.json$/.test(f));
  if (bankFiles.length === 0) throw new Error(`no term_meta_bank_*.json in ${RAW_DIR}`);
  for (const file of bankFiles) {
    const entries = JSON.parse(readFileSync(join(RAW_DIR, file), 'utf8')) as MetaEntry[];
    for (const [term, kind, data] of entries) {
      if (kind !== 'freq') continue;
      const level = LEVEL_BY_TAG[data.frequency.displayValue];
      if (level === undefined) continue; // N1 and anything unexpected
      const key = `${term}|${data.reading}`;
      const existing = byKey.get(key);
      // Same word tagged at multiple levels: keep the earliest-learned (highest number).
      if (existing === undefined || level > existing.level) {
        byKey.set(key, { term, reading: data.reading, level });
      }
    }
  }
  return [...byKey.values()];
}

function indexJmdict(): { byKanji: Map<string, JmdictWord[]>; byKana: Map<string, JmdictWord[]> } {
  const parsed = JSON.parse(readFileSync(join(RAW_DIR, 'jmdict-eng-3.6.2.json'), 'utf8')) as {
    words: JmdictWord[];
  };
  const byKanji = new Map<string, JmdictWord[]>();
  const byKana = new Map<string, JmdictWord[]>();
  const push = (map: Map<string, JmdictWord[]>, key: string, word: JmdictWord) => {
    const list = map.get(key);
    if (list) list.push(word);
    else map.set(key, [word]);
  };
  for (const word of parsed.words) {
    for (const k of word.kanji) push(byKanji, k.text, word);
    for (const k of word.kana) push(byKana, k.text, word);
  }
  return { byKanji, byKana };
}

function cleanGloss(raw: string): string {
  // Strip parens innermost-out so nested groups (e.g. "dog (Canis (lupus)
  // familiaris)") don't leave a stray unmatched ")" behind after one pass.
  // Assumes parens in jmdict glosses are balanced; the committed-data
  // invariant test (glosses contain no "(" or ")") catches any future gloss
  // where that assumption doesn't hold.
  let cleaned = raw;
  let previous: string;
  do {
    previous = cleaned;
    cleaned = cleaned.replace(/\([^()]*\)/g, '');
  } while (cleaned !== previous);
  return cleaned.replace(/\s+/g, ' ').trim();
}

function truncateAtWord(s: string): string {
  const cut = s.slice(0, GLOSS_MAX);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 10 ? cut.slice(0, lastSpace) : cut).replace(/[,;: ]+$/, '');
}

function appliesToTerm(applies: string[], term: string): boolean {
  return applies.includes('*') || applies.includes(term);
}

function pickGlossAndPos(word: JmdictWord, term: string): { gloss: string; pos: string } | null {
  let fallback: { gloss: string; pos: string } | null = null;
  for (const sense of word.sense) {
    if (!appliesToTerm(sense.appliesToKanji, term) && word.kanji.length > 0) continue;
    const pos = sense.partOfSpeech[0] ?? 'unclassified';
    for (const g of sense.gloss) {
      if (g.lang !== 'eng') continue;
      const cleaned = cleanGloss(g.text);
      if (cleaned.length === 0) continue;
      if (cleaned.length <= GLOSS_MAX) return { gloss: cleaned, pos };
      if (fallback === null) fallback = { gloss: truncateAtWord(cleaned), pos };
    }
  }
  return fallback;
}

function toCard(entry: JlptEntry, word: JmdictWord): Card | null {
  const kanaOnly = entry.term === entry.reading || isKana(entry.term);
  const glossPos = pickGlossAndPos(word, entry.term);
  if (glossPos === null || glossPos.gloss.length === 0) return null;
  const applying = kanaOnly
    ? [entry.reading]
    : word.kana
        // jmdict-simplified includes "sk" (search-only) variants such as the
        // obfuscated half-width-katakana form of 死ぬ ("ﾀﾋぬ"); isKana rejects
        // those the same way it rejects any other non-kana reading.
        .filter((k) => appliesToTerm(k.appliesToKanji, entry.term) && isKana(k.text))
        .map((k) => k.text);
  const kana = [entry.reading, ...applying.filter((r) => r !== entry.reading)];
  return {
    id: `jm-${word.id}`,
    kanji: kanaOnly ? null : entry.term,
    kana,
    gloss: glossPos.gloss,
    pos: glossPos.pos,
    jlpt: entry.level,
    source: 'jlpt',
  };
}

const SENTENCE_MAX_JA = 50;

interface Hook {
  ja: string;
  en: string;
}

/**
 * Shortest qualifying Tatoeba sentence per search key.
 * Inverted index: for each sentence, probe every substring up to the longest
 * card key against the key set — O(sentences × length × maxKeyLen) rather than
 * O(cards × sentences).
 */
function buildSentenceIndex(keys: Set<string>): Map<string, Hook> {
  let maxKeyLen = 1;
  for (const key of keys) maxKeyLen = Math.max(maxKeyLen, key.length);

  const best = new Map<string, Hook>();
  const raw = readFileSync(join(RAW_DIR, 'tatoeba-jpn-eng.tsv'), 'utf8');
  for (const line of raw.split('\n')) {
    const parts = line.split('\t');
    if (parts.length < 2) continue;
    const en = parts[0].trim();
    const ja = parts[1].trim();
    if (ja.length === 0 || ja.length > SENTENCE_MAX_JA || en.length === 0) continue;

    const seenHere = new Set<string>();
    for (let i = 0; i < ja.length; i++) {
      for (let len = 1; len <= maxKeyLen && i + len <= ja.length; len++) {
        const candidate = ja.slice(i, i + len);
        if (!keys.has(candidate) || seenHere.has(candidate)) continue;
        seenHere.add(candidate);
        const current = best.get(candidate);
        if (current === undefined || ja.length < current.ja.length) {
          best.set(candidate, { ja, en });
        }
      }
    }
  }
  return best;
}

/** Primary English meaning per kanji, only for characters the corpus uses. */
function buildKanjiMeanings(used: Set<string>): Map<string, string> {
  interface KMeaning { lang: string; value: string }
  interface KGroup { meanings?: KMeaning[] }
  interface KChar {
    literal: string;
    readingMeaning?: { groups?: KGroup[] } | null;
  }
  const parsed = JSON.parse(
    readFileSync(join(RAW_DIR, 'kanjidic2-en-3.6.2.json'), 'utf8'),
  ) as { characters: KChar[] };

  const meanings = new Map<string, string>();
  for (const char of parsed.characters) {
    if (!used.has(char.literal)) continue;
    const first = (char.readingMeaning?.groups ?? [])
      .flatMap((g) => g.meanings ?? [])
      .find((m) => m.lang === 'en');
    if (first && first.value.trim().length > 0) meanings.set(char.literal, first.value.trim());
  }
  return meanings;
}

const KANJI_RANGE = /[\u4e00-\u9fff\u3400-\u4dbf]/;

/** Attaches sentence + kanjiParts in place. Both fields stay optional. */
function attachHooks(cardsByLevel: Map<2 | 3 | 4 | 5, Card[]>): void {
  const all = [...cardsByLevel.values()].flat();

  const keys = new Set<string>();
  const usedKanji = new Set<string>();
  for (const card of all) {
    keys.add(card.kanji ?? card.kana[0]);
    for (const ch of card.kanji ?? '') if (KANJI_RANGE.test(ch)) usedKanji.add(ch);
  }

  const sentences = buildSentenceIndex(keys);
  const meanings = buildKanjiMeanings(usedKanji);

  let withSentence = 0;
  let withParts = 0;
  for (const card of all) {
    const hook = sentences.get(card.kanji ?? card.kana[0]);
    if (hook) {
      card.sentence = hook;
      withSentence += 1;
    }
    if (card.kanji !== null) {
      const parts = [...card.kanji]
        .filter((ch) => KANJI_RANGE.test(ch))
        .map((ch) => ({ char: ch, meaning: meanings.get(ch) ?? '' }))
        .filter((p) => p.meaning.length > 0);
      if (parts.length > 0) {
        card.kanjiParts = parts;
        withParts += 1;
      }
    }
  }
  console.log(`hooks: ${withSentence}/${all.length} sentences, ${withParts} cards with kanji parts`);
}

function main(): void {
  const entries = readJlptEntries();
  console.log(`JLPT entries (N5-N2, deduped): ${entries.length}`);
  const { byKanji, byKana } = indexJmdict();

  const cardsByLevel = new Map<2 | 3 | 4 | 5, Card[]>([[5, []], [4, []], [3, []], [2, []]]);
  const cardById = new Map<string, Card>();
  const unmatched: JlptEntry[] = [];
  const mergedReadings: string[] = [];
  let duplicatesSkipped = 0;

  for (const entry of entries) {
    const kanaOnly = entry.term === entry.reading || isKana(entry.term);
    const candidates = (kanaOnly ? byKana.get(entry.term) : byKanji.get(entry.term)) ?? [];
    const word = candidates.find((w) => w.kana.some((k) => k.text === entry.reading)) ?? null;
    const card = word === null ? null : toCard(entry, word);
    if (card === null) {
      unmatched.push(entry);
      continue;
    }
    const survivor = cardById.get(card.id);
    if (survivor !== undefined) {
      // Same jmdict word already produced a card (e.g. a kanji-headed term and
      // a separate kana-only bank entry both resolve to the same jmdict id).
      // Merge this entry's reading onto the survivor instead of dropping it —
      // for kana-only entries `applying` is just [entry.reading], so skipping
      // outright would erase that reading from the corpus entirely. Always
      // append (never unshift): kana[0] must stay the survivor's canonical
      // reading.
      if (survivor.kana.includes(entry.reading)) {
        duplicatesSkipped += 1;
      } else {
        survivor.kana.push(entry.reading);
        mergedReadings.push(
          `merged reading ${entry.reading} into ${survivor.id} (${survivor.kanji ?? survivor.kana[0]})`,
        );
      }
      continue;
    }
    cardById.set(card.id, card);
    cardsByLevel.get(entry.level)!.push(card);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const entryCounts = new Map<number, number>([[5, 0], [4, 0], [3, 0], [2, 0]]);
  for (const e of entries) entryCounts.set(e.level, (entryCounts.get(e.level) ?? 0) + 1);

  attachHooks(cardsByLevel);

  for (const [level, cards] of cardsByLevel) {
    const rate = cards.length / (entryCounts.get(level) || 1);
    console.log(`N${level}: ${cards.length}/${entryCounts.get(level)} matched (${(rate * 100).toFixed(1)}%)`);
    if (rate < MIN_MATCH_RATE) {
      console.error(`FAIL: N${level} match rate ${(rate * 100).toFixed(1)}% < ${MIN_MATCH_RATE * 100}%`);
      process.exit(1);
    }
    const file = { listVersion: LIST_VERSION, level, cards };
    levelFileSchema.parse(file); // hard-fail on any schema violation before writing
    writeFileSync(join(OUT_DIR, `jlpt-n${level}.json`), JSON.stringify(file));
  }
  console.log(`Unmatched: ${unmatched.length}`);
  for (const u of unmatched.slice(0, 20)) console.log(`  dropped: ${u.term} / ${u.reading} (N${u.level})`);
  console.log(`Duplicate entries merged (new reading added): ${mergedReadings.length}`);
  console.log(`Duplicate entries skipped (reading already present): ${duplicatesSkipped}`);
  for (const m of mergedReadings.slice(0, 12)) console.log(`  ${m}`);
}

main();
