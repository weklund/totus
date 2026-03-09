CREATE TABLE "audit_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"owner_id" varchar(64) NOT NULL,
	"actor_type" varchar(16) NOT NULL,
	"actor_id" varchar(64),
	"grant_id" uuid,
	"event_type" varchar(64) NOT NULL,
	"resource_type" varchar(64),
	"resource_detail" jsonb,
	"ip_address" "inet",
	"user_agent" text,
	"session_id" varchar(256),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_audit_actor_type" CHECK ("audit_events"."actor_type" IN ('owner', 'viewer', 'system'))
);
--> statement-breakpoint
CREATE TABLE "health_data" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"metric_type" varchar(64) NOT NULL,
	"date" date NOT NULL,
	"value_encrypted" "bytea" NOT NULL,
	"source" varchar(32) NOT NULL,
	"source_id" varchar(256),
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_health_data_user_metric_date_source" UNIQUE("user_id","metric_type","date","source")
);
--> statement-breakpoint
CREATE TABLE "oura_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"access_token_enc" "bytea" NOT NULL,
	"refresh_token_enc" "bytea" NOT NULL,
	"token_expires_at" timestamp with time zone NOT NULL,
	"last_sync_at" timestamp with time zone,
	"sync_cursor" varchar(256),
	"sync_status" varchar(16) DEFAULT 'idle' NOT NULL,
	"sync_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_oura_sync_status" CHECK ("oura_connections"."sync_status" IN ('idle', 'syncing', 'error'))
);
--> statement-breakpoint
CREATE TABLE "share_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" varchar(64) NOT NULL,
	"owner_id" varchar(64) NOT NULL,
	"label" varchar(255) NOT NULL,
	"note" varchar(1000),
	"allowed_metrics" text[] NOT NULL,
	"data_start" date NOT NULL,
	"data_end" date NOT NULL,
	"grant_expires" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"view_count" integer DEFAULT 0 NOT NULL,
	"last_viewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "share_grants_token_unique" UNIQUE("token"),
	CONSTRAINT "chk_share_grants_date_range" CHECK ("share_grants"."data_end" >= "share_grants"."data_start"),
	CONSTRAINT "chk_share_grants_metrics_nonempty" CHECK (array_length("share_grants"."allowed_metrics", 1) IS NOT NULL AND array_length("share_grants"."allowed_metrics", 1) > 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"display_name" varchar(100) NOT NULL,
	"kms_key_arn" varchar(256) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "health_data" ADD CONSTRAINT "health_data_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oura_connections" ADD CONSTRAINT "oura_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_grants" ADD CONSTRAINT "share_grants_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_events_owner_created" ON "audit_events" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_events_grant_created" ON "audit_events" USING btree ("grant_id","created_at") WHERE "audit_events"."grant_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_audit_events_owner_type_created" ON "audit_events" USING btree ("owner_id","event_type","created_at");--> statement-breakpoint
CREATE INDEX "idx_health_data_user_metric_date" ON "health_data" USING btree ("user_id","metric_type","date");--> statement-breakpoint
CREATE INDEX "idx_health_data_user_metric_summary" ON "health_data" USING btree ("user_id","metric_type");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_oura_connections_user" ON "oura_connections" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_oura_connections_user_id" ON "oura_connections" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_share_grants_active_token" ON "share_grants" USING btree ("token") WHERE "share_grants"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_share_grants_owner_created" ON "share_grants" USING btree ("owner_id","created_at");