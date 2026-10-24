CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pharmacy_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"action" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pharmacy_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"phone_normalized" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_scope" UNIQUE("pharmacy_id","id"),
	CONSTRAINT "customer_phone_required" CHECK (length("customers"."phone_normalized") > 0)
);
--> statement-breakpoint
CREATE TABLE "follow_up_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pharmacy_id" uuid NOT NULL,
	"follow_up_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follow_ups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pharmacy_id" uuid NOT NULL,
	"purchase_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"calculated_date" date,
	"manual_date" date,
	"next_date" date NOT NULL,
	"last_contacted_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"closed_reason" text,
	"resolving_purchase_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follow_ups_purchase_id_unique" UNIQUE("purchase_id"),
	CONSTRAINT "follow_scope" UNIQUE("pharmacy_id","id"),
	CONSTRAINT "follow_status" CHECK (("follow_ups"."status" = 'open' and "follow_ups"."closed_at" is null and "follow_ups"."closed_reason" is null and "follow_ups"."resolving_purchase_id" is null) or ("follow_ups"."status" = 'closed' and "follow_ups"."closed_at" is not null and "follow_ups"."closed_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "medicines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pharmacy_id" uuid NOT NULL,
	"name" text NOT NULL,
	"strength" text DEFAULT '' NOT NULL,
	"form" text DEFAULT '' NOT NULL,
	"identity_key" text NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "medicine_scope" UNIQUE("pharmacy_id","id"),
	CONSTRAINT "medicine_identity" UNIQUE("pharmacy_id","identity_key")
);
--> statement-breakpoint
CREATE TABLE "mutation_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pharmacy_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"command" text NOT NULL,
	"payload_hash" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mutation_identity" UNIQUE("pharmacy_id","actor_id","request_id")
);
--> statement-breakpoint
CREATE TABLE "pharmacies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"contact" text DEFAULT '' NOT NULL,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pharmacy_timezone" CHECK ("pharmacies"."timezone" = 'Asia/Kolkata')
);
--> statement-breakpoint
CREATE TABLE "purchase_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pharmacy_id" uuid NOT NULL,
	"purchase_id" uuid NOT NULL,
	"medicine_id" uuid NOT NULL,
	"name" text NOT NULL,
	"strength" text NOT NULL,
	"form" text NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"unit" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "item_medicine_unit" UNIQUE("purchase_id","medicine_id","unit"),
	CONSTRAINT "positive_quantity" CHECK ("purchase_items"."quantity" > 0),
	CONSTRAINT "known_unit" CHECK ("purchase_items"."unit" in ('tablets','strips','capsules','bottles','packs','tubes','sachets','other'))
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pharmacy_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"sequence" bigserial NOT NULL,
	"purchase_date" date NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"reminder_enabled" boolean DEFAULT false NOT NULL,
	"supply_start" date,
	"supply_days" integer,
	"run_out_date" date,
	"refill_of_purchase_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchases_sequence_unique" UNIQUE("sequence"),
	CONSTRAINT "purchase_scope" UNIQUE("pharmacy_id","id"),
	CONSTRAINT "purchase_status" CHECK ("purchases"."status" in ('active','cancelled')),
	CONSTRAINT "purchase_not_self" CHECK ("purchases"."refill_of_purchase_id" is null or "purchases"."refill_of_purchase_id" <> "purchases"."id"),
	CONSTRAINT "supply_valid" CHECK (not "purchases"."reminder_enabled" or ("purchases"."supply_days" between 1 and 365 and "purchases"."supply_start" >= "purchases"."purchase_date" and "purchases"."run_out_date" = "purchases"."supply_start" + "purchases"."supply_days"))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pharmacy_id" uuid NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "one_owner_per_pharmacy" UNIQUE("pharmacy_id"),
	CONSTRAINT "user_scope" UNIQUE("pharmacy_id","id")
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_up_events" ADD CONSTRAINT "follow_up_events_pharmacy_id_follow_up_id_follow_ups_pharmacy_id_id_fk" FOREIGN KEY ("pharmacy_id","follow_up_id") REFERENCES "public"."follow_ups"("pharmacy_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_up_events" ADD CONSTRAINT "follow_up_events_pharmacy_id_actor_id_users_pharmacy_id_id_fk" FOREIGN KEY ("pharmacy_id","actor_id") REFERENCES "public"."users"("pharmacy_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_pharmacy_id_purchase_id_purchases_pharmacy_id_id_fk" FOREIGN KEY ("pharmacy_id","purchase_id") REFERENCES "public"."purchases"("pharmacy_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_pharmacy_id_resolving_purchase_id_purchases_pharmacy_id_id_fk" FOREIGN KEY ("pharmacy_id","resolving_purchase_id") REFERENCES "public"."purchases"("pharmacy_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medicines" ADD CONSTRAINT "medicines_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mutation_receipts" ADD CONSTRAINT "mutation_receipts_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mutation_receipts" ADD CONSTRAINT "mutation_receipts_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_pharmacy_id_purchase_id_purchases_pharmacy_id_id_fk" FOREIGN KEY ("pharmacy_id","purchase_id") REFERENCES "public"."purchases"("pharmacy_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_pharmacy_id_medicine_id_medicines_pharmacy_id_id_fk" FOREIGN KEY ("pharmacy_id","medicine_id") REFERENCES "public"."medicines"("pharmacy_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_pharmacy_id_customer_id_customers_pharmacy_id_id_fk" FOREIGN KEY ("pharmacy_id","customer_id") REFERENCES "public"."customers"("pharmacy_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_pharmacy_id_created_by_users_pharmacy_id_id_fk" FOREIGN KEY ("pharmacy_id","created_by") REFERENCES "public"."users"("pharmacy_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_pharmacy_id_updated_by_users_pharmacy_id_id_fk" FOREIGN KEY ("pharmacy_id","updated_by") REFERENCES "public"."users"("pharmacy_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_pharmacy_id_refill_of_purchase_id_purchases_pharmacy_id_id_fk" FOREIGN KEY ("pharmacy_id","refill_of_purchase_id") REFERENCES "public"."purchases"("pharmacy_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_name" ON "customers" USING btree ("pharmacy_id","name");--> statement-breakpoint
CREATE INDEX "customer_phone" ON "customers" USING btree ("pharmacy_id","phone_normalized");--> statement-breakpoint
CREATE INDEX "follow_event_time" ON "follow_up_events" USING btree ("follow_up_id","created_at");--> statement-breakpoint
CREATE INDEX "follow_due" ON "follow_ups" USING btree ("pharmacy_id","status","next_date","id");--> statement-breakpoint
CREATE INDEX "purchase_date" ON "purchases" USING btree ("pharmacy_id","purchase_date","id");--> statement-breakpoint
CREATE INDEX "purchase_customer" ON "purchases" USING btree ("customer_id","purchase_date");--> statement-breakpoint
CREATE INDEX "session_user_expiry" ON "sessions" USING btree ("user_id","expires_at");