CREATE TABLE "medicine_supplies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pharmacy_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"purchase_id" uuid NOT NULL,
	"medicine_id" uuid NOT NULL,
	"included" boolean DEFAULT true NOT NULL,
	"supply_start" date NOT NULL,
	"supply_days" integer NOT NULL,
	"mode" text NOT NULL,
	"remaining_override" integer,
	"remaining_used" integer DEFAULT 0 NOT NULL,
	"run_out_date" date NOT NULL,
	"reminder_enabled" boolean DEFAULT false NOT NULL,
	"manual_date" date,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supply_scope" UNIQUE("pharmacy_id","id"),
	CONSTRAINT "supply_purchase_medicine" UNIQUE("purchase_id","medicine_id"),
	CONSTRAINT "medicine_supply_days" CHECK ("medicine_supplies"."supply_days" between 1 and 365 and "medicine_supplies"."remaining_used" >= 0 and ("medicine_supplies"."remaining_override" is null or "medicine_supplies"."remaining_override" between 0 and 365)),
	CONSTRAINT "medicine_supply_mode" CHECK ("medicine_supplies"."mode" in ('extend','replace')),
	CONSTRAINT "medicine_supply_end" CHECK ("medicine_supplies"."run_out_date" = "medicine_supplies"."supply_start" + "medicine_supplies"."supply_days" + "medicine_supplies"."remaining_used")
);
--> statement-breakpoint
ALTER TABLE "follow_ups" DROP CONSTRAINT "follow_ups_purchase_id_unique";--> statement-breakpoint
ALTER TABLE "follow_ups" ADD COLUMN "supply_id" uuid;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD COLUMN "customer_id" uuid;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD COLUMN "medicine_id" uuid;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD COLUMN "paused_state" jsonb;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "supply_model" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "medicine_supplies" ADD CONSTRAINT "medicine_supplies_pharmacy_id_purchase_id_purchases_pharmacy_id_id_fk" FOREIGN KEY ("pharmacy_id","purchase_id") REFERENCES "public"."purchases"("pharmacy_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medicine_supplies" ADD CONSTRAINT "medicine_supplies_pharmacy_id_customer_id_customers_pharmacy_id_id_fk" FOREIGN KEY ("pharmacy_id","customer_id") REFERENCES "public"."customers"("pharmacy_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medicine_supplies" ADD CONSTRAINT "medicine_supplies_pharmacy_id_medicine_id_medicines_pharmacy_id_id_fk" FOREIGN KEY ("pharmacy_id","medicine_id") REFERENCES "public"."medicines"("pharmacy_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "medicine_supply_customer" ON "medicine_supplies" USING btree ("pharmacy_id","customer_id","medicine_id");--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_pharmacy_id_supply_id_medicine_supplies_pharmacy_id_id_fk" FOREIGN KEY ("pharmacy_id","supply_id") REFERENCES "public"."medicine_supplies"("pharmacy_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "legacy_follow_purchase" ON "follow_ups" USING btree ("purchase_id") WHERE "follow_ups"."supply_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "one_open_medicine_follow" ON "follow_ups" USING btree ("pharmacy_id","customer_id","medicine_id") WHERE "follow_ups"."status" = 'open' and "follow_ups"."supply_id" is not null;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_supply_id_unique" UNIQUE("supply_id");--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "medicine_follow_identity" CHECK (("follow_ups"."supply_id" is null and "follow_ups"."customer_id" is null and "follow_ups"."medicine_id" is null) or ("follow_ups"."supply_id" is not null and "follow_ups"."customer_id" is not null and "follow_ups"."medicine_id" is not null));