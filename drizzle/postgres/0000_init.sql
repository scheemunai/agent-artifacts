CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"suspended_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifact_versions" (
	"artifact_id" text NOT NULL,
	"version_num" integer NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"change_summary" text,
	"restored_from_version" integer,
	"created_by_bot" text,
	"created_at" bigint NOT NULL,
	CONSTRAINT "artifact_versions_artifact_id_version_num_pk" PRIMARY KEY("artifact_id","version_num"),
	CONSTRAINT "ck_artifact_versions_type" CHECK ("artifact_versions"."type" IN ('markdown', 'html')),
	CONSTRAINT "ck_artifact_versions_version_num" CHECK ("artifact_versions"."version_num" >= 1)
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"slug" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"metadata" text DEFAULT '{}' NOT NULL,
	"version_num" integer DEFAULT 1 NOT NULL,
	"created_by_bot" text,
	"deleted_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "ck_artifacts_type" CHECK ("artifacts"."type" IN ('markdown', 'html')),
	CONSTRAINT "ck_artifacts_version_num" CHECK ("artifacts"."version_num" >= 1)
);
--> statement-breakpoint
CREATE TABLE "bots" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"name" text NOT NULL,
	"byline" text,
	"api_key_hash" text NOT NULL,
	"api_key_last4" text NOT NULL,
	"last_used_at" bigint,
	"revoked_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "magic_link_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"email" text NOT NULL,
	"account_id" text,
	"created_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	"consumed_at" bigint
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"created_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	"last_seen_at" bigint
);
--> statement-breakpoint
CREATE TABLE "share_viewers" (
	"share_id" text NOT NULL,
	"viewer_id" text NOT NULL,
	"first_viewed_at" bigint NOT NULL,
	"last_viewed_at" bigint NOT NULL,
	"view_count" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "share_viewers_share_id_viewer_id_pk" PRIMARY KEY("share_id","viewer_id")
);
--> statement-breakpoint
CREATE TABLE "shares" (
	"id" text PRIMARY KEY NOT NULL,
	"artifact_id" text NOT NULL,
	"password_hash" text,
	"password_updated_at" bigint,
	"expires_at" bigint,
	"revoked_at" bigint,
	"view_count" integer DEFAULT 0 NOT NULL,
	"unique_viewer_count" integer DEFAULT 0 NOT NULL,
	"last_viewed_at" bigint,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" text NOT NULL,
	"content" text NOT NULL,
	"slots" text NOT NULL,
	"created_from_artifact" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "ck_templates_type" CHECK ("templates"."type" IN ('markdown', 'html'))
);
--> statement-breakpoint
ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_created_by_bot_bots_id_fk" FOREIGN KEY ("created_by_bot") REFERENCES "public"."bots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_created_by_bot_bots_id_fk" FOREIGN KEY ("created_by_bot") REFERENCES "public"."bots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bots" ADD CONSTRAINT "bots_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "magic_link_tokens" ADD CONSTRAINT "magic_link_tokens_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_viewers" ADD CONSTRAINT "share_viewers_share_id_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."shares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shares" ADD CONSTRAINT "shares_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_created_from_artifact_artifacts_id_fk" FOREIGN KEY ("created_from_artifact") REFERENCES "public"."artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_accounts_email" ON "accounts" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_artifacts_account_slug_live" ON "artifacts" USING btree ("account_id","slug") WHERE "artifacts"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_artifacts_account_list" ON "artifacts" USING btree ("account_id","updated_at","id") WHERE "artifacts"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_artifacts_bot" ON "artifacts" USING btree ("created_by_bot");--> statement-breakpoint
CREATE INDEX "idx_artifacts_purge" ON "artifacts" USING btree ("deleted_at") WHERE "artifacts"."deleted_at" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_bots_api_key_hash" ON "bots" USING btree ("api_key_hash");--> statement-breakpoint
CREATE INDEX "idx_bots_account" ON "bots" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_magic_link_token_hash" ON "magic_link_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_magic_link_expires" ON "magic_link_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_sessions_account" ON "sessions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_sessions_expires" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_shares_artifact_active" ON "shares" USING btree ("artifact_id") WHERE "shares"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_shares_artifact" ON "shares" USING btree ("artifact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_templates_account_slug" ON "templates" USING btree ("account_id","slug") WHERE "templates"."account_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_templates_builtin_slug" ON "templates" USING btree ("slug") WHERE "templates"."account_id" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_templates_account" ON "templates" USING btree ("account_id");