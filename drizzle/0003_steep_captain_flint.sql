CREATE TABLE `list_cards` (
	`list_id` integer NOT NULL,
	`card_id` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`list_id`, `card_id`),
	FOREIGN KEY (`list_id`) REFERENCES `lists`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `lists` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lists_name_unique` ON `lists` (`name`);