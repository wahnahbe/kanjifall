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

function main(): void {
  const entries = readJlptEntries();
  console.log(`JLPT entries (N5-N2, deduped): ${entries.length}`);
  const { byKanji, byKana } = indexJmdict();

  const cardsByLevel = new Map<2 | 3 | 4 | 5, Card[]>([[5, []], [4, []], [3, []], [2, []]]);
  const usedIds = new Set<string>();
  const unmatched: JlptEntry[] = [];
  const duplicateIds: string[] = [];

  for (const entry of entries) {
    const kanaOnly = entry.term === entry.reading || isKana(entry.term);
    const candidates = (kanaOnly ? byKana.get(entry.term) : byKanji.get(entry.term)) ?? [];
    const word = candidates.find((w) => w.kana.some((k) => k.text === entry.reading)) ?? null;
    const card = word === null ? null : toCard(entry, word);
    if (card === null) {
      unmatched.push(entry);
      continue;
    }
    if (usedIds.has(card.id)) {
      duplicateIds.push(`${card.id} (${entry.term}/${entry.reading})`);
      continue;
    }
    usedIds.add(card.id);
    cardsByLevel.get(entry.level)!.push(card);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const entryCounts = new Map<number, number>([[5, 0], [4, 0], [3, 0], [2, 0]]);
  for (const e of entries) entryCounts.set(e.level, (entryCounts.get(e.level) ?? 0) + 1);

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
  if (duplicateIds.length > 0) {
    console.log(`Duplicate jmdict ids skipped: ${duplicateIds.length}`);
    for (const d of duplicateIds.slice(0, 10)) console.log(`  dup: ${d}`);
  }
}

main();
