ALTER TABLE "customers" ADD COLUMN "age" integer;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customer_age_range" CHECK ("customers"."age" between 0 and 130);