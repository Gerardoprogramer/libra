CREATE TYPE "public"."copyright_status" AS ENUM('PUBLIC_DOMAIN_VERIFIED', 'LICENSED', 'ORIGINAL', 'PENDING_REVIEW', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."publication_status" AS ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED');--> statement-breakpoint
CREATE TABLE "authors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"birth_year" integer,
	"death_year" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "authors_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "book_authors" (
	"book_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "book_authors_book_id_author_id_pk" PRIMARY KEY("book_id","author_id")
);
--> statement-breakpoint
CREATE TABLE "books" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"original_title" text NOT NULL,
	"original_language" varchar(10) NOT NULL,
	"original_publication_year" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "books_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "chapters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"word_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "editions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"language" varchar(10) NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"translator" text,
	"publication_year" integer,
	"cover_url" text,
	"source_name" text,
	"source_identifier" text,
	"source_url" text,
	"copyright_status" "copyright_status" DEFAULT 'PENDING_REVIEW' NOT NULL,
	"publication_status" "publication_status" DEFAULT 'DRAFT' NOT NULL,
	"copyright_notes" text,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "book_authors" ADD CONSTRAINT "book_authors_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_authors" ADD CONSTRAINT "book_authors_author_id_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."authors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editions" ADD CONSTRAINT "editions_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chapters_edition_idx" ON "chapters" USING btree ("edition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chapters_edition_slug_idx" ON "chapters" USING btree ("edition_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "chapters_edition_number_idx" ON "chapters" USING btree ("edition_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "editions_book_slug_idx" ON "editions" USING btree ("book_id","slug");--> statement-breakpoint
CREATE INDEX "editions_book_language_idx" ON "editions" USING btree ("book_id","language");--> statement-breakpoint
CREATE INDEX "editions_publication_status_idx" ON "editions" USING btree ("publication_status");--> statement-breakpoint
CREATE INDEX "editions_copyright_status_idx" ON "editions" USING btree ("copyright_status");--> statement-breakpoint
CREATE UNIQUE INDEX "editions_source_idx" ON "editions" USING btree ("source_name","source_identifier");