import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { editions } from "./editions";

/**
 * A normalized illustration stored in R2, once for the whole library. Its identity is the source image (SHA-256 of
 * the original bytes), the codec that normalized it (sharp, libvips and encoder settings) and the width it was
 * normalized to: the same identity always has one row and so one object key. A later import normalizes the image again
 * and reuses the row only when its bytes are the same, after verifying the stored object; the row alone never proves
 * the object is in the store. The object key is the SHA-256 of the normalized bytes with the extension of their format, and
 * the table checks that it is exactly that: a key can never point at bytes of another hash or format. Row level
 * security is enabled with no policy: only the server's own database role can read or write it.
 */
export const imageAssets = pgTable(
  "image_assets",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    /** SHA-256 (hex) of the original image bytes in the EPUB. */
    sourceSha256: text("source_sha256").notNull(),

    /**
     * The ImageCodec id: sharp, libvips and the encoding libraries at their effective versions, the platform, SIMD
     * and the settings (sharpCodecId in scripts/lib/sharp-codec.ts; docs/epub-images.md).
     */
    codecId: text("codec_id").notNull(),

    /** The maximum width the image was normalized to (IMAGE_LIMITS.maxNormalizedWidth). */
    maxWidth: integer("max_width").notNull(),

    /** SHA-256 (hex) of the normalized bytes that were stored. */
    sha256: text("sha256").notNull(),

    /** R2 object key: illustrations/<sha256>.<jpg|png|webp>. */
    objectKey: text("object_key").notNull(),

    mediaType: text("media_type").notNull(),

    width: integer("width").notNull(),

    height: integer("height").notNull(),

    byteSize: integer("byte_size").notNull(),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("image_assets_identity_idx").on(table.sourceSha256, table.codecId, table.maxWidth),

    // Two sources can normalize to the same bytes (they differed only in metadata): they share the object.
    index("image_assets_object_key_idx").on(table.objectKey),

    check("image_assets_source_sha256_check", sql`${table.sourceSha256} ~ '^[0-9a-f]{64}$'`),

    check("image_assets_sha256_check", sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),

    check("image_assets_codec_id_check", sql`length(btrim(${table.codecId})) BETWEEN 1 AND 200`),

    check("image_assets_media_type_check", sql`${table.mediaType} IN ('image/jpeg', 'image/png', 'image/webp')`),

    check(
      "image_assets_object_key_check",
      sql`${table.objectKey} = 'illustrations/' || ${table.sha256} || '.' || CASE ${table.mediaType} WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' WHEN 'image/webp' THEN 'webp' END`,
    ),

    check(
      "image_assets_dimensions_check",
      sql`${table.maxWidth} > 0 AND ${table.width} > 0 AND ${table.height} > 0 AND ${table.width} <= ${table.maxWidth}`,
    ),

    check("image_assets_byte_size_check", sql`${table.byteSize} > 0`),
  ],
).enableRLS();

/**
 * Which normalized illustration an edition uses for each image path of its EPUB. Figure blocks reference images by
 * that archive path, so a chapter's blocks never hold a storage key: the path resolves through this table to the
 * asset of the same edition. The same image in several editions is one image_assets row with one association per
 * edition. Deleting an edition removes its associations; an asset still associated cannot be deleted. Row level
 * security is enabled with no policy, like image_assets.
 */
export const editionAssets = pgTable(
  "edition_assets",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    editionId: uuid("edition_id")
      .notNull()
      .references(() => editions.id, {
        onDelete: "cascade",
      }),

    assetId: uuid("asset_id")
      .notNull()
      .references(() => imageAssets.id, {
        onDelete: "restrict",
      }),

    /** The image's normalized path inside the EPUB archive, as figure blocks reference it. */
    sourcePath: text("source_path").notNull(),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("edition_assets_edition_source_path_idx").on(table.editionId, table.sourcePath),

    index("edition_assets_asset_idx").on(table.assetId),

    // The rules of a figure path (parseChapterBlocks): relative, no URL scheme, no backslash, and no empty, "." or
    // ".." segment.
    check(
      "edition_assets_source_path_check",
      sql`length(${table.sourcePath}) BETWEEN 1 AND 1024 AND ${table.sourcePath} !~* '^[a-z][a-z0-9+.-]*:' AND strpos(${table.sourcePath}, chr(92)) = 0 AND ${table.sourcePath} !~ '(^|/)([.]|[.][.])?(/|$)'`,
    ),
  ],
).enableRLS();
