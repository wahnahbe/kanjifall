import { z } from 'zod';
import type { Card } from '../engine/types.ts';

/** Single source of truth for the gloss length cap — shared by the schema
 *  gate, the build pipeline, homograph merging, and list import. */
export const GLOSS_MAX = 28;

export const cardSchema = z.object({
  id: z.string().min(1),
  kanji: z.string().min(1).nullable(),
  kana: z.array(z.string().min(1)).min(1),
  gloss: z.string().min(1).max(GLOSS_MAX),
  pos: z.string().min(1),
  jlpt: z.union([z.literal(5), z.literal(4), z.literal(3), z.literal(2), z.null()]),
  // Required, not optional: the pipeline guarantees it, and a missing tier
  // should fail loudly at load rather than silently degrade the gate (§4.1).
  tier: z.number().int().positive(),
  source: z.union([z.literal('jlpt'), z.literal('custom')]),
  sentence: z.object({ ja: z.string().min(1), en: z.string().min(1) }).optional(),
  kanjiParts: z.array(z.object({ char: z.string().min(1), meaning: z.string().min(1) })).optional(),
});

export const levelFileSchema = z.object({
  listVersion: z.string().min(1),
  level: z.union([z.literal(5), z.literal(4), z.literal(3), z.literal(2)]),
  cards: z.array(cardSchema).min(1),
});

export type LevelFile = z.infer<typeof levelFileSchema>;

/** Compile-time bridge: a zod card must remain assignable to the engine Card. */
export function toCards(file: LevelFile): Card[] {
  return file.cards;
}
