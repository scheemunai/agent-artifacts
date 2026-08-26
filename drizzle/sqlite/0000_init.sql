CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text,
	`suspended_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_accounts_email` ON `accounts` (`email`);--> statement-breakpoint
CREATE TABLE `artifact_versions` (
	`artifact_id` text NOT NULL,
	`version_num` integer NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`content_hash` text NOT NULL,
	`change_summary` text,
	`restored_from_version` integer,
	`created_by_bot` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`artifact_id`, `version_num`),
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_bot`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "ck_artifact_versions_type" CHECK("artifact_versions"."type" IN ('markdown', 'html')),
	CONSTRAINT "ck_artifact_versions_version_num" CHECK("artifact_versions"."version_num" >= 1)
);
--> statement-breakpoint
CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`slug` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`content_hash` text NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`version_num` integer DEFAULT 1 NOT NULL,
	`created_by_bot` text,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_bot`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "ck_artifacts_type" CHECK("artifacts"."type" IN ('markdown', 'html')),
	CONSTRAINT "ck_artifacts_version_num" CHECK("artifacts"."version_num" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_artifacts_account_slug_live` ON `artifacts` (`account_id`,`slug`) WHERE "artifacts"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `idx_artifacts_account_list` ON `artifacts` (`account_id`,`updated_at`,`id`) WHERE "artifacts"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `idx_artifacts_bot` ON `artifacts` (`created_by_bot`);--> statement-breakpoint
CREATE INDEX `idx_artifacts_purge` ON `artifacts` (`deleted_at`) WHERE "artifacts"."deleted_at" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `bots` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`name` text NOT NULL,
	`byline` text,
	`api_key_hash` text NOT NULL,
	`api_key_last4` text NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_bots_api_key_hash` ON `bots` (`api_key_hash`);--> statement-breakpoint
CREATE INDEX `idx_bots_account` ON `bots` (`account_id`);--> statement-breakpoint
CREATE TABLE `magic_link_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`email` text NOT NULL,
	`account_id` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_magic_link_token_hash` ON `magic_link_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_magic_link_expires` ON `magic_link_tokens` (`expires_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`last_seen_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_account` ON `sessions` (`account_id`);--> statement-breakpoint
CREATE INDEX `idx_sessions_expires` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `share_viewers` (
	`share_id` text NOT NULL,
	`viewer_id` text NOT NULL,
	`first_viewed_at` integer NOT NULL,
	`last_viewed_at` integer NOT NULL,
	`view_count` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`share_id`, `viewer_id`),
	FOREIGN KEY (`share_id`) REFERENCES `shares`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `shares` (
	`id` text PRIMARY KEY NOT NULL,
	`artifact_id` text NOT NULL,
	`password_hash` text,
	`password_updated_at` integer,
	`expires_at` integer,
	`revoked_at` integer,
	`view_count` integer DEFAULT 0 NOT NULL,
	`unique_viewer_count` integer DEFAULT 0 NOT NULL,
	`last_viewed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_shares_artifact_active` ON `shares` (`artifact_id`) WHERE "shares"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX `idx_shares_artifact` ON `shares` (`artifact_id`);--> statement-breakpoint
CREATE TABLE `templates` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`type` text NOT NULL,
	`content` text NOT NULL,
	`slots` text NOT NULL,
	`created_from_artifact` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_from_artifact`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "ck_templates_type" CHECK("templates"."type" IN ('markdown', 'html'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_templates_account_slug` ON `templates` (`account_id`,`slug`) WHERE "templates"."account_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_templates_builtin_slug` ON `templates` (`slug`) WHERE "templates"."account_id" IS NULL;--> statement-breakpoint
CREATE INDEX `idx_templates_account` ON `templates` (`account_id`);