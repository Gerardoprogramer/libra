ALTER TABLE "reading_progress" DROP CONSTRAINT "reading_progress_edition_chapter_fk";
--> statement-breakpoint
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_edition_chapter_fk" FOREIGN KEY ("edition_id","chapter_id") REFERENCES "public"."chapters"("edition_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reading_progress_edition_chapter_idx" ON "reading_progress" USING btree ("edition_id","chapter_id");
--> statement-breakpoint
REVOKE ALL ON TABLE public.reading_progress FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.reading_progress TO authenticated;
--> statement-breakpoint
-- Preserve ordering even for existing clients still using the Supabase API.
CREATE FUNCTION public.reject_stale_reading_progress() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.updated_at < OLD.updated_at THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER reading_progress_reject_stale
BEFORE UPDATE ON public.reading_progress
FOR EACH ROW EXECUTE FUNCTION public.reject_stale_reading_progress();
