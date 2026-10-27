CREATE TABLE "edition_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"source_path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "edition_assets_source_path_check" CHECK (length("edition_assets"."source_path") BETWEEN 1 AND 1024 AND "edition_assets"."source_path" !~* '^[a-z][a-z0-9+.-]*:' AND strpos("edition_assets"."source_path", chr(92)) = 0 AND "edition_assets"."source_path" !~ '(^|/)([.]|[.][.])?(/|$)')
);
--> statement-breakpoint
ALTER TABLE "edition_assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "image_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_sha256" text NOT NULL,
	"codec_id" text NOT NULL,
	"max_width" integer NOT NULL,
	"sha256" text NOT NULL,
	"object_key" text NOT NULL,
	"media_type" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"byte_size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "image_assets_source_sha256_check" CHECK ("image_assets"."source_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "image_assets_sha256_check" CHECK ("image_assets"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "image_assets_codec_id_check" CHECK (length(btrim("image_assets"."codec_id")) BETWEEN 1 AND 200),
	CONSTRAINT "image_assets_media_type_check" CHECK ("image_assets"."media_type" IN ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "image_assets_object_key_check" CHECK ("image_assets"."object_key" = 'illustrations/' || "image_assets"."sha256" || '.' || CASE "image_assets"."media_type" WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' WHEN 'image/webp' THEN 'webp' END),
	CONSTRAINT "image_assets_dimensions_check" CHECK ("image_assets"."max_width" > 0 AND "image_assets"."width" > 0 AND "image_assets"."height" > 0 AND "image_assets"."width" <= "image_assets"."max_width"),
	CONSTRAINT "image_assets_byte_size_check" CHECK ("image_assets"."byte_size" > 0)
);
--> statement-breakpoint
ALTER TABLE "image_assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN "blocks" jsonb;--> statement-breakpoint
ALTER TABLE "edition_assets" ADD CONSTRAINT "edition_assets_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_assets" ADD CONSTRAINT "edition_assets_asset_id_image_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."image_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "edition_assets_edition_source_path_idx" ON "edition_assets" USING btree ("edition_id","source_path");--> statement-breakpoint
CREATE INDEX "edition_assets_asset_idx" ON "edition_assets" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "image_assets_identity_idx" ON "image_assets" USING btree ("source_sha256","codec_id","max_width");--> statement-breakpoint
CREATE INDEX "image_assets_object_key_idx" ON "image_assets" USING btree ("object_key");--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_blocks_envelope_check" CHECK ("chapters"."blocks" IS NULL OR (jsonb_typeof("chapters"."blocks") = 'object' AND "chapters"."blocks" -> 'version' = '1'::jsonb AND jsonb_typeof("chapters"."blocks" -> 'blocks') = 'array'));