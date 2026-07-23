import { z } from 'zod';

export const gameModeSchema = z.union([z.literal('reading'), z.literal('recall')]);

export const createRunSchema = z.object({
  id: z.uuid(),
  startedAt: z.number().int().positive(),
  mode: gameModeSchema,
  pool: z.string().min(1), // n5|n4|n3|n2|mixed|revenge
  appVersion: z.string().min(1),
  listVersion: z.string().min(1),
});

export const attemptSchema = z.object({
  cardId: z.string().min(1),
  mode: gameModeSchema,
  outcome: z.union([z.literal('kill'), z.literal('miss')]),
  msToFirstKey: z.number().int().nonnegative().nullable(),
  msToKill: z.number().int().nonnegative().nullable(),
  backspaceCount: z.number().int().nonnegative(),
  hintShown: z.boolean(),
  wasTargeted: z.boolean(),
  airborneCount: z.number().int().nonnegative(),
  speedLevel: z.number().int().positive(),
  createdAt: z.number().int().positive(),
});

export const wrongSubmitSchema = z.object({
  submittedKana: z.string().min(1),
  airborneCardIds: z.array(z.string()),
  matchedOtherCardId: z.string().nullable(),
  createdAt: z.number().int().positive(),
});

export const eventsBatchSchema = z.object({
  batchId: z.uuid(),
  attempts: z.array(attemptSchema),
  wrongSubmits: z.array(wrongSubmitSchema),
});

export const finalizeRunSchema = z.object({
  endedAt: z.number().int().positive(),
  score: z.number().int().nonnegative(),
  wavesCleared: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  pausedMs: z.number().int().nonnegative(),
  maxCombo: z.number().int().nonnegative(),
  accuracy: z.number().min(0).max(1),
});

export const profileSchema = z.object({
  targetLevel: z.union([z.literal(5), z.literal(4), z.literal(3), z.literal(2)]),
  examDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dailyWordGoal: z.number().int().positive().max(500),
});

export type CreateRun = z.infer<typeof createRunSchema>;
export type AttemptEvent = z.infer<typeof attemptSchema>;
export type WrongSubmitEvent = z.infer<typeof wrongSubmitSchema>;
export type EventsBatch = z.infer<typeof eventsBatchSchema>;
export type FinalizeRun = z.infer<typeof finalizeRunSchema>;
export type Profile = z.infer<typeof profileSchema>;
