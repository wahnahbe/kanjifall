import { z } from 'zod';
import type { Card } from '../engine/types.ts';

export const cardSchema = z.object({
  id: z.string().min(1),
  kanji: z.string().min(1).nullable(),
  kana: z.array(z.string().min(1)).min(1),
  gloss: z.string().min(1).max(28),
  pos: z.string().min(1),
  jlpt: z.union([z.literal(5), z.literal(4), z.literal(3), z.literal(2), z.null()]),
  source: z.union([z.literal('jlpt'), z.literal('custom')]),
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
