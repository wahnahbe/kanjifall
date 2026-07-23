CREATE TABLE `attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`card_id` text NOT NULL,
	`mode` text NOT NULL,
	`outcome` text NOT NULL,
	`ms_to_first_key` integer,
	`ms_to_kill` integer,
	`backspace_count` integer NOT NULL,
	`hint_shown` integer NOT NULL,
	`was_targeted` integer NOT NULL,
	`airborne_count` integer NOT NULL,
	`speed_level` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `cards` (
	`id` text PRIMARY KEY NOT NULL,
	`kanji` text,
	`kana` text NOT NULL,
	`gloss` text NOT NULL,
	`pos` text NOT NULL,
	`jlpt` integer,
	`source` text NOT NULL,
	`list_version` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ingested_batches` (
	`batch_id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`received_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `profile` (
	`id` integer PRIMARY KEY NOT NULL,
	`target_level` integer NOT NULL,
	`exam_date` text NOT NULL,
	`daily_word_goal` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`mode` text NOT NULL,
	`pool` text NOT NULL,
	`score` integer,
	`waves_cleared` integer,
	`duration_ms` integer,
	`paused_ms` integer,
	`max_combo` integer,
	`accuracy` real,
	`app_version` text NOT NULL,
	`list_version` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `wrong_submits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`submitted_kana` text NOT NULL,
	`airborne_card_ids` text NOT NULL,
	`matched_other_card_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
