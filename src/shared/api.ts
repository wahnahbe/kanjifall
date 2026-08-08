import { z } from 'zod';
import { cardSchema } from '../data/schema';

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

export const introductionSchema = z.object({
  cardId: z.string().min(1),
  introducedAt: z.number().int().positive(),
});

export const eventsBatchSchema = z.object({
  batchId: z.uuid(),
  attempts: z.array(attemptSchema),
  wrongSubmits: z.array(wrongSubmitSchema),
  introductions: z.array(introductionSchema).optional().default([]),
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
export type IntroductionEvent = z.infer<typeof introductionSchema>;
export type EventsBatch = z.infer<typeof eventsBatchSchema>;
export type FinalizeRun = z.infer<typeof finalizeRunSchema>;
export type Profile = z.infer<typeof profileSchema>;

export const levelStatSchema = z.object({
  level: z.union([z.literal(5), z.literal(4), z.literal(3), z.literal(2)]),
  total: z.number().int(),
  encountered: z.number().int(),
  learned: z.number().int(),
  coverage: z.number(),
  mastery: z.number(),
});

export const statsOverviewSchema = z.object({
  learned: z.object({ reading: z.number().int(), recall: z.number().int() }),
  levels: z.array(levelStatSchema),
  estimatedLevel: z.union([z.literal(5), z.literal(4), z.literal(3), z.literal(2), z.null()]),
  pace: z.object({
    learnRatePerDay: z.number(),
    requiredRatePerDay: z.number(),
    remainingTargetWords: z.number().int(),
    daysToExam: z.number().int(),
    onPace: z.boolean(),
  }),
  trend: z.array(z.object({ date: z.string(), words: z.number().int(), accuracy: z.number() })),
  streakDates: z.array(z.string()),
  leeches: z.array(z.object({
    cardId: z.string(), kanji: z.string().nullable(), kana: z.string(), gloss: z.string(),
    strength: z.number().int(), encounters: z.number().int(),
  })),
});
export type StatsOverview = z.infer<typeof statsOverviewSchema>;

export const tierProgressSchema = z.object({
  level: z.union([z.literal(5), z.literal(4), z.literal(3), z.literal(2)]),
  /** Active tier for the level, or null when every tier passes. */
  index: z.number().int().positive().nullable(),
  totalTiers: z.number().int().nonnegative(),
  /** size/solid/amnestied/unreachable describe the ACTIVE tier; all 0 when
   *  index is null. */
  size: z.number().int().nonnegative(),
  solid: z.number().int().nonnegative(),
  amnestied: z.number().int().nonnegative(),
  /** Cards this run's mode can never introduce (currently: kana-only cards
   *  under mode 'reading'). They leave the gate's denominator, same as
   *  amnesty — 0 whenever mode is absent or 'recall' (tiered-vocab spec,
   *  final-review Fix 1). */
  unreachable: z.number().int().nonnegative(),
});
export type TierProgress = z.infer<typeof tierProgressSchema>;

export const runPlanSchema = z.object({
  newCardIds: z.array(z.string()),
  seenCards: z.array(z.object({ id: z.string(), weight: z.number().positive() })),
  runBudget: z.number().int().nonnegative(),
  tiers: z.array(tierProgressSchema),
});
export type RunPlan = z.infer<typeof runPlanSchema>;

export const previewRequestSchema = z.object({ text: z.string().min(1) });
export const listSaveRequestSchema = z.object({
  name: z.string().trim().min(1).max(60),
  text: z.string().min(1),
});

export const parsedLineSchema = z.object({
  /** 1-based line number in the original paste (blanks/comments counted, not returned). */
  line: z.number().int().positive(),
  raw: z.string(),
  status: z.union([
    z.literal('jlpt'), z.literal('custom-existing'), z.literal('custom-new'), z.literal('error'),
  ]),
  cardId: z.string().optional(),
  display: z.object({
    kanji: z.string().nullable(), kana: z.string(), gloss: z.string(),
  }).optional(),
  error: z.string().optional(),
});

export const previewResponseSchema = z.object({
  lines: z.array(parsedLineSchema),
  summary: z.object({
    total: z.number().int().nonnegative(),
    resolved: z.number().int().nonnegative(),
    customNew: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
  }),
});

export const listSummarySchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  cardCount: z.number().int().nonnegative(),
  updatedAt: z.number().int().positive(),
});

/** Custom cards ship whole from the DB — same shape as a level-file card
 *  minus the tier the pipeline stamps (custom cards have none). */
export const customCardSchema = cardSchema
  .omit({ tier: true })
  .extend({ jlpt: z.null(), source: z.literal('custom') });

export const listCardsResponseSchema = z.object({
  list: z.object({
    id: z.number().int().positive(),
    name: z.string(),
    updatedAt: z.number().int().positive(),
  }),
  customCards: z.array(customCardSchema),
  jlptCardIds: z.array(z.string()),
});

export const listSaveResponseSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  cardCount: z.number().int().nonnegative(),
  replaced: z.boolean(),
});

export type PreviewResponse = z.infer<typeof previewResponseSchema>;
export type ListSummary = z.infer<typeof listSummarySchema>;
export type ListCardsResponse = z.infer<typeof listCardsResponseSchema>;
export type ListSaveResponse = z.infer<typeof listSaveResponseSchema>;
