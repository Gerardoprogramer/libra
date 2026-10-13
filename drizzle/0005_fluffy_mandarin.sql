ALTER TABLE "reading_progress" DROP CONSTRAINT "reading_progress_edition_id_editions_id_fk";
--> statement-breakpoint
ALTER TABLE "reading_progress" DROP CONSTRAINT "reading_progress_chapter_id_chapters_id_fk";
--> statement-breakpoint
CREATE UNIQUE INDEX "chapters_edition_id_idx" ON "chapters" USING btree ("edition_id","id");
--> statement-breakpoint
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_edition_chapter_fk" FOREIGN KEY ("edition_id","chapter_id") REFERENCES "public"."chapters"("edition_id","id") ON DELETE cascade ON UPDATE no action;