import { integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const cards = sqliteTable('cards', {
  id: text('id').primaryKey(),
  kanji: text('kanji'),
  kana: text('kana', { mode: 'json' }).$type<string[]>().notNull(),
  gloss: text('gloss').notNull(),
  pos: text('pos').notNull(),
  jlpt: integer('jlpt'),
  // Frequency tier within the card's JLPT level (tiered-vocab spec §4.1).
  // Nullable at the DB layer: custom cards have no tier.
  tier: integer('tier'),
  source: text('source').notNull(),
  listVersion: text('list_version').notNull(),
});

export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(), // client-generated UUID (idempotent create)
  startedAt: integer('started_at').notNull(),
  endedAt: integer('ended_at'),
  mode: text('mode').notNull(),
  pool: text('pool').notNull(),
  score: integer('score'),
  wavesCleared: integer('waves_cleared'),
  durationMs: integer('duration_ms'),
  pausedMs: integer('paused_ms'),
  maxCombo: integer('max_combo'),
  accuracy: real('accuracy'),
  appVersion: text('app_version').notNull(),
  listVersion: text('list_version').notNull(),
});

export const attempts = sqliteTable('attempts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: text('run_id').notNull().references(() => runs.id),
  cardId: text('card_id').notNull(),
  mode: text('mode').notNull(),
  outcome: text('outcome').notNull(), // 'kill' | 'miss'
  msToFirstKey: integer('ms_to_first_key'),
  msToKill: integer('ms_to_kill'),
  backspaceCount: integer('backspace_count').notNull(),
  hintShown: integer('hint_shown', { mode: 'boolean' }).notNull(),
  wasTargeted: integer('was_targeted', { mode: 'boolean' }).notNull(),
  airborneCount: integer('airborne_count').notNull(),
  speedLevel: integer('speed_level').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const wrongSubmits = sqliteTable('wrong_submits', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: text('run_id').notNull().references(() => runs.id),
  submittedKana: text('submitted_kana').notNull(),
  airborneCardIds: text('airborne_card_ids', { mode: 'json' }).$type<string[]>().notNull(),
  matchedOtherCardId: text('matched_other_card_id'),
  createdAt: integer('created_at').notNull(),
});

export const profile = sqliteTable('profile', {
  id: integer('id').primaryKey(), // single row, id = 1
  targetLevel: integer('target_level').notNull(),
  examDate: text('exam_date').notNull(), // ISO yyyy-mm-dd
  dailyWordGoal: integer('daily_word_goal').notNull(),
});

export const ingestedBatches = sqliteTable('ingested_batches', {
  batchId: text('batch_id').primaryKey(),
  runId: text('run_id').notNull(),
  receivedAt: integer('received_at').notNull(),
});

export const introductions = sqliteTable('introductions', {
  // PRIMARY KEY: a card is introduced once, ever. Makes outbox replays
  // idempotent and stops the daily budget being spent twice on one card.
  cardId: text('card_id').primaryKey(),
  runId: text('run_id').notNull(),
  introducedAt: integer('introduced_at').notNull(),
});

export const lists = sqliteTable('lists', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const listCards = sqliteTable('list_cards', {
  listId: integer('list_id').notNull().references(() => lists.id),
  cardId: text('card_id').notNull(),
  position: integer('position').notNull(),
}, (t) => [primaryKey({ columns: [t.listId, t.cardId] })]);
