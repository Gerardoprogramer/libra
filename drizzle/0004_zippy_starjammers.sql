CREATE TABLE "reading_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"edition_id" uuid NOT NULL,
	"chapter_id" uuid NOT NULL,
	"paragraph_index" integer DEFAULT 0 NOT NULL,
	"percentage" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reading_progress_paragraph_index_check" CHECK ("reading_progress"."paragraph_index" >= 0),
	CONSTRAINT "reading_progress_percentage_check" CHECK ("reading_progress"."percentage" >= 0 AND "reading_progress"."percentage" <= 100)
);
--> statement-breakpoint
ALTER TABLE "reading_progress" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reading_progress_user_edition_idx" ON "reading_progress" USING btree ("user_id","edition_id");--> statement-breakpoint
CREATE INDEX "reading_progress_user_updated_idx" ON "reading_progress" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE POLICY "reading_progress_select_own" ON "reading_progress" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "reading_progress"."user_id");--> statement-breakpoint
CREATE POLICY "reading_progress_insert_own" ON "reading_progress" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select auth.uid()) = "reading_progress"."user_id");--> statement-breakpoint
CREATE POLICY "reading_progress_update_own" ON "reading_progress" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select auth.uid()) = "reading_progress"."user_id") WITH CHECK ((select auth.uid()) = "reading_progress"."user_id");--> statement-breakpoint
CREATE POLICY "reading_progress_delete_own" ON "reading_progress" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select auth.uid()) = "reading_progress"."user_id");