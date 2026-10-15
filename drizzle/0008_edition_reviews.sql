CREATE TYPE "public"."edition_review_action" AS ENUM('PUBLISH', 'REJECT', 'ARCHIVE', 'PREFER');--> statement-breakpoint
CREATE TABLE "edition_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid NOT NULL,
	"action" "edition_review_action" NOT NULL,
	"previous_publication_status" "publication_status" NOT NULL,
	"new_publication_status" "publication_status" NOT NULL,
	"previous_copyright_status" "copyright_status" NOT NULL,
	"new_copyright_status" "copyright_status" NOT NULL,
	"notes" text,
	"chapter_count" integer NOT NULL,
	"word_count" integer NOT NULL,
	"reviewer" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "edition_reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "edition_reviews" ADD CONSTRAINT "edition_reviews_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "edition_reviews_edition_idx" ON "edition_reviews" USING btree ("edition_id","created_at");